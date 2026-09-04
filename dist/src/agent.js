import { BELIEF_CHANGE_TYPE } from "./bdi/beliefs.js";
import { DeliverParcelsDesire, PickUpParcelDesire, VisitCellDesire, } from "./bdi/desires.js";
import { CommittedDesireIntention, SearchIntention } from "./bdi/intentions.js";
import { OptionEvaluator } from "./bdi/option_evaluator.js";
import { GridFormationMission, ParcelHandoffMission, RENDEZVOUS_PARTICIPANT, RendezvousMission, } from "./llm/mission.js";
import { ParcelHandoffIntention, } from "./llm/tools/handoff/index.js";
import { PDDLPlanner } from "./pddl/pddlPlanner.js";
import { DELIBERATION_CYCLE_REASON, PLAN_SEGMENT_EVENT, } from "./utils/_logging.js";
import { GameMap } from "./utils/map.js";
import { Drop, MovementAction, PickUp, } from "./utils/move.js";
import { Plan } from "./utils/plan.js";
import { Position } from "./utils/position.js";
/** Terminal reasons for which the otherwise continuous agent loop can stop. */
export var AGENT_EXIT_REASON;
(function (AGENT_EXIT_REASON) {
    AGENT_EXIT_REASON["NO_FEASIBLE_PLAN"] = "no-feasible-plan";
})(AGENT_EXIT_REASON || (AGENT_EXIT_REASON = {}));
/** Outcome of one complete planning pass across options and search fallback. */
export var PLAN_BUILD_STATUS;
(function (PLAN_BUILD_STATUS) {
    PLAN_BUILD_STATUS["PLANNED"] = "planned";
    PLAN_BUILD_STATUS["SATISFIED"] = "satisfied";
    PLAN_BUILD_STATUS["COORDINATION_REQUESTED"] = "coordination-requested";
    PLAN_BUILD_STATUS["TRANSIENTLY_BLOCKED"] = "transiently-blocked";
    PLAN_BUILD_STATUS["INFEASIBLE"] = "infeasible";
})(PLAN_BUILD_STATUS || (PLAN_BUILD_STATUS = {}));
/** Coordinates option evaluation, exploration fallback, planning, and execution. */
export class Agent {
    constructor(beliefs, desireGenerator, pathfinder, actionFactory, logger, rendezvousCoordinator, parcelHandoffCoordinator, useLLM = false, llmMissionHandler = undefined) {
        this.beliefs = beliefs;
        this.pathfinder = pathfinder;
        this.actionFactory = actionFactory;
        this.logger = logger;
        this.rendezvousCoordinator = rendezvousCoordinator;
        this.parcelHandoffCoordinator = parcelHandoffCoordinator;
        this.id = "";
        this.position = new Position(0, 0);
        this.useLLM = useLLM;
        this.missionHandler = llmMissionHandler;
        this.score = undefined;
        this.isBeliefChanged = false;
        this.pendingBeliefChanges = [];
        this.selectedDesireSequence = [];
        this.searchIntention = new SearchIntention();
        this.currentIntention = this.searchIntention;
        this.plan = new Plan();
        this.planOwner = undefined;
        this.temporarilyBlockedCells = new Map();
        this.gridPositionWaiters = new Set();
        this.hasAuthoritativePosition = false;
        this.deliberationCycle = 0;
        this.isRendezvousStateChanged = false;
        this.isHandoffStateChanged = false;
        this.pddlPlanner = new PDDLPlanner(this.actionFactory);
        this.optionEvaluator = new OptionEvaluator(desireGenerator);
        this.rendezvousCoordinator.subscribeStateChanges(() => {
            this.isRendezvousStateChanged = true;
        });
        this.parcelHandoffCoordinator.subscribeStateChanges(() => {
            this.isHandoffStateChanged = true;
        });
    }
    updatePosition(x, y) {
        this.position.x = x;
        this.position.y = y;
        this.hasAuthoritativePosition = true;
        if (!this.position.isGridAligned()) {
            return;
        }
        this.rendezvousCoordinator.observePosition(new Position(this.position.x, this.position.y));
        this.parcelHandoffCoordinator.observePosition(new Position(this.position.x, this.position.y));
        const waiters = [...this.gridPositionWaiters];
        this.gridPositionWaiters.clear();
        for (const resolve of waiters) {
            resolve();
        }
    }
    /** Applies an authoritative score update and reports newly awarded points. */
    updateScore(score) {
        const previousScore = this.score;
        this.score = score;
        if (previousScore === undefined || score <= previousScore) {
            return;
        }
        this.logger.logDeliveryGain({
            pointsGained: score - previousScore,
            totalScore: score,
        });
    }
    /** Exposes the selected decision to read-only observers. */
    currentDecision() {
        return this.currentIntention.describe();
    }
    /** Exposes active mission metadata to read-only observers. */
    activeMissionDescriptions() {
        return this.missionHandler?.getActiveMission().map((mission) => mission.describe()) ?? [];
    }
    /** Exposes temporary navigation walls without leaking the mutable map. */
    temporaryBlockedCellSnapshots() {
        return [...this.temporarilyBlockedCells.values()].map((blockedCell) => new Position(blockedCell.position.x, blockedCell.position.y));
    }
    /** Exposes the search intention's persistent cluster visit history. */
    pickupClusterSnapshots() {
        return this.searchIntention.clusterSnapshots(this.beliefs.pickup_cells, this.beliefs.pickupCellObservationTimes());
    }
    currentScore() {
        return this.score;
    }
    currentDeliberationCycle() {
        return this.deliberationCycle;
    }
    usesLLM() {
        return this.useLLM;
    }
    handleMsgFromChat(senderId, senderName, msg) {
        if (!this.useLLM)
            return;
        this.rendezvousCoordinator.releaseWaitingGridFormations();
        this.logger.logMissionReceived({ senderName, message: msg });
        this.missionHandler?.addPendingMission(senderId, senderName, msg);
    }
    /** Continuously selects and executes the most valuable available intention. */
    async agent_loop() {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let deliberateImmediately = false;
        let nextCycleReason = DELIBERATION_CYCLE_REASON.AGENT_STARTED;
        while (true) {
            if (!deliberateImmediately) {
                await new Promise((resolve) => setTimeout(resolve, this.beliefs.movement_duration));
            }
            deliberateImmediately = false;
            let cycleReason = nextCycleReason;
            nextCycleReason = DELIBERATION_CYCLE_REASON.PLAN_COMPLETED;
            const cycleBeliefChanges = cycleReason
                === DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED
                ? this.consumePendingBeliefChanges()
                : [];
            await this.waitForGridPosition();
            this.rendezvousCoordinator.observePosition(this.position);
            if (this.rendezvousCoordinator.isWaitingForPeer()) {
                await this.rendezvousCoordinator.waitForPeer();
            }
            if (this.completeRendezvousMissions()) {
                cycleReason =
                    DELIBERATION_CYCLE_REASON.RENDEZVOUS_COMPLETED;
            }
            if (this.completeHandoffMissions()) {
                cycleReason = DELIBERATION_CYCLE_REASON.HANDOFF_COMPLETED;
            }
            this.isRendezvousStateChanged = false;
            if (this.useLLM) {
                if (this.missionHandler?.isMissionWaiting()) {
                    const missions = await this.missionHandler.evaluateMission(this.getPlanningContext());
                    for (const mission of missions) {
                        this.logger.logMissionActivated(mission.describe());
                        if (mission instanceof RendezvousMission) {
                            this.proposeRendezvous(mission);
                        }
                        else if (mission instanceof GridFormationMission) {
                            this.considerGridFormation(mission);
                        }
                        else if (mission instanceof ParcelHandoffMission) {
                            this.parcelHandoffCoordinator.activate(mission.getId(), mission.reward);
                        }
                    }
                }
                this.missionHandler?.completeMoveToMissionsAt(this.position);
            }
            this.deliberationCycle += 1;
            this.refreshTemporaryBlockedCells();
            this.beliefs.updateParcelRewards();
            this.pathfinder.clearPathLengthCache();
            const context = this.getPlanningContext();
            this.parcelHandoffCoordinator.refresh(context);
            this.isHandoffStateChanged = false;
            let planStatus = await this.buildParcelHandoffPlan(context);
            if (planStatus === undefined) {
                const initialOptionEvaluation = this.optionEvaluator.evaluateWithGraph(context);
                this.selectedDesireSequence =
                    initialOptionEvaluation.bestSequence;
                const optionSearchTrace = {
                    evaluationPasses: [initialOptionEvaluation.graph],
                    planningAttempts: [],
                };
                planStatus = await this.buildPlanWithTrace(context, optionSearchTrace);
                this.logOptionSearch(context, optionSearchTrace, planStatus, cycleReason, cycleBeliefChanges);
            }
            if (planStatus === PLAN_BUILD_STATUS.COORDINATION_REQUESTED) {
                await this.rendezvousCoordinator
                    .waitForGridFormationCommit();
                deliberateImmediately = true;
                nextCycleReason =
                    DELIBERATION_CYCLE_REASON.RENDEZVOUS_STATE_CHANGED;
                continue;
            }
            if (planStatus === PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED) {
                nextCycleReason =
                    DELIBERATION_CYCLE_REASON.TRANSIENT_BLOCKAGE_RETRY;
                continue;
            }
            if (planStatus === PLAN_BUILD_STATUS.INFEASIBLE) {
                return AGENT_EXIT_REASON.NO_FEASIBLE_PLAN;
            }
            if (!this.plan.isEmpty()) {
                this.logCurrentPlanSegment(PLAN_SEGMENT_EVENT.STARTED);
            }
            let planInterrupted = false;
            let planMoved = false;
            while (!this.plan.isEmpty()) {
                const handoffInterruption = this.handleHandoffStateChange();
                if (handoffInterruption) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    nextCycleReason = handoffInterruption;
                    break;
                }
                const rendezvousInterruption = await this.handleRendezvousStateChange();
                if (rendezvousInterruption) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    nextCycleReason = rendezvousInterruption;
                    break;
                }
                if (this.isBeliefChanged) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    this.isBeliefChanged = false;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED;
                    break;
                }
                const nextAction = this.plan.topAction();
                if (!nextAction) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, nextAction.executionDelayMilliseconds(this.beliefs.movement_duration)));
                const delayedRendezvousInterruption = await this.handleRendezvousStateChange();
                if (delayedRendezvousInterruption) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    nextCycleReason = delayedRendezvousInterruption;
                    break;
                }
                const delayedHandoffInterruption = this.handleHandoffStateChange();
                if (delayedHandoffInterruption) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    nextCycleReason = delayedHandoffInterruption;
                    break;
                }
                if (this.isBeliefChanged) {
                    deliberateImmediately = true;
                    planInterrupted = true;
                    this.isBeliefChanged = false;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED;
                    break;
                }
                const movementDestination = nextAction instanceof MovementAction
                    ? nextAction.destinationFrom(this.position)
                    : undefined;
                const actionSucceeded = await nextAction.execute();
                if (!actionSucceeded) {
                    if (movementDestination) {
                        this.addTemporaryBlockedCell(movementDestination);
                        this.logger.logMoveFailure({
                            destination: movementDestination,
                        });
                    }
                    deliberateImmediately = true;
                    planInterrupted = true;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.ACTION_FAILED;
                    break;
                }
                this.plan.popAction();
                if (movementDestination) {
                    planMoved = true;
                    this.missionHandler?.completeMoveToMissionsAt(movementDestination);
                }
                if (nextAction instanceof Drop
                    && nextAction.deliveredParcels()) {
                    this.missionHandler?.completeDropAtMissionsAt(this.position);
                }
                if (this.plan.isEmpty()) {
                    this.logCurrentPlanSegment(PLAN_SEGMENT_EVENT.COMPLETED);
                }
                if (this.plan.isEmpty()
                    && this.planOwner instanceof CommittedDesireIntention
                    && this.selectedDesireSequence.length > 0) {
                    if (nextAction instanceof PickUp
                        && !this.isBeliefChanged
                        && await this.continueSelectedDesireSequence()) {
                        continue;
                    }
                    this.selectedDesireSequence = [];
                    deliberateImmediately = true;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.OPTION_SEGMENT_COMPLETED;
                }
            }
            if (planInterrupted) {
                this.logCurrentPlanSegment(PLAN_SEGMENT_EVENT.INTERRUPTED, nextCycleReason);
                this.planOwner = undefined;
            }
            if (!planInterrupted && this.plan.isEmpty()) {
                this.completePlan();
                if (planMoved) {
                    this.temporarilyBlockedCells.clear();
                }
            }
        }
    }
    async buildPlan(context = this.getPlanningContext()) {
        return this.buildPlanWithTrace(context);
    }
    /** Builds a plan and optionally records each evaluator and planner decision. */
    async buildPlanWithTrace(context, optionSearchTrace) {
        const handoffStatus = await this.buildParcelHandoffPlan(context);
        if (handoffStatus !== undefined) {
            this.selectedDesireSequence = [];
            return handoffStatus;
        }
        const rejectedRootOptionIdentities = new Set();
        while (this.selectedDesireSequence.length > 0) {
            const bestDesire = this.selectedDesireSequence[0];
            if (bestDesire instanceof VisitCellDesire
                && this.rendezvousCoordinator.commitSelectedGridFormation(bestDesire.missionId, bestDesire.targetCell)) {
                this.selectedDesireSequence = [];
                this.currentIntention = new CommittedDesireIntention(bestDesire);
                this.replacePlan([]);
                return PLAN_BUILD_STATUS.COORDINATION_REQUESTED;
            }
            const actionBuild = await this.buildDesireActionResult(bestDesire, context);
            const estimatedTraversability = optionSearchTrace
                ? this.findRootTraversability(optionSearchTrace.evaluationPasses[optionSearchTrace.evaluationPasses.length - 1], bestDesire.identity())
                : undefined;
            optionSearchTrace?.planningAttempts.push({
                optionIdentity: bestDesire.identity(),
                optionType: bestDesire.type,
                parcelId: bestDesire.parcelId,
                targetPosition: bestDesire.targetCell,
                estimatedTraversability,
                result: actionBuild.result,
                planner: actionBuild.planner,
                plannedActions: actionBuild.result === "planned"
                    ? actionBuild.actions.length
                    : 0,
                reason: actionBuild.result === "planned"
                    ? "route-found"
                    : actionBuild.reason,
            });
            if (actionBuild.result === "planned") {
                this.selectedDesireSequence.shift();
                const intention = new CommittedDesireIntention(bestDesire);
                this.currentIntention = intention;
                this.replacePlan(actionBuild.actions, intention);
                return PLAN_BUILD_STATUS.PLANNED;
            }
            rejectedRootOptionIdentities.add(bestDesire.identity());
            const fallbackEvaluation = this.optionEvaluator.evaluateWithGraph(context, rejectedRootOptionIdentities);
            this.selectedDesireSequence = fallbackEvaluation.bestSequence;
            optionSearchTrace?.evaluationPasses.push(fallbackEvaluation.graph);
        }
        return this.resolveTemporaryBlockageStatus(await this.buildSearchPlan(context));
    }
    /** Builds one committed handoff segment before ordinary option search. */
    async buildParcelHandoffPlan(context) {
        const instruction = this.parcelHandoffCoordinator.instruction(context);
        if (!instruction) {
            return undefined;
        }
        // A committed handoff supersedes every ordinary option sequence. In
        // particular, do not let a DROP left over from an interrupted
        // PICK -> DROP sequence run after the handoff pickup completes.
        this.selectedDesireSequence = [];
        const intention = new ParcelHandoffIntention(instruction);
        this.currentIntention = intention;
        if (instruction.type === "wait") {
            this.replacePlan([], intention);
            return PLAN_BUILD_STATUS.SATISFIED;
        }
        const navigationContext = instruction.type === "pick-up"
            || instruction.type === "stage"
            ? {
                ...context,
                gameMap: this.gameMapWithAdditionalWall(context.gameMap, instruction.blockedCell),
            }
            : context;
        const navigation = await this.buildNavigationActions(instruction.target, navigationContext);
        if (!navigation) {
            this.replacePlan([], intention);
            return PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED;
        }
        let actions;
        switch (instruction.type) {
            case "pick-up":
            case "collect":
                actions = [
                    ...navigation.actions,
                    context.actionFactory.pickUp(instruction.parcelId, context.agentId),
                ];
                break;
            case "stage":
                actions = navigation.actions;
                break;
            case "release":
                actions = [
                    context.actionFactory.putDownForHandoff(instruction.parcelId, context.agentId, instruction.handoffCell),
                    ...navigation.actions,
                ];
                break;
            case "deliver":
                actions = [
                    ...navigation.actions,
                    context.actionFactory.drop(context.agentId),
                ];
                break;
        }
        this.replacePlan(actions, intention);
        return PLAN_BUILD_STATUS.PLANNED;
    }
    /** Emits the evaluator graph together with real A-star/PDDL validation outcomes. */
    logOptionSearch(context, trace, planStatus, cycleReason, beliefChanges) {
        const log = {
            cycle: this.deliberationCycle,
            cycleReason,
            beliefChanges,
            agentId: this.id,
            position: context.agentPosition,
            evaluationPasses: trace.evaluationPasses,
            planningAttempts: trace.planningAttempts,
            outcome: this.optionSearchOutcome(planStatus),
            planSource: this.optionPlanSource(trace, planStatus),
            plannedActions: this.plan.size(),
            activeParcelHandoff: this.parcelHandoffCoordinator.snapshot(),
            nextExecutableObjective: this.currentIntention.describe(),
        };
        this.logger.logBranchAndBound(log);
    }
    logCurrentPlanSegment(event, interruptionReason) {
        const sharedLog = {
            cycle: this.deliberationCycle,
            objective: this.planOwner?.describe()
                ?? this.currentIntention.describe(),
            remainingActions: this.plan.size(),
        };
        if (event === PLAN_SEGMENT_EVENT.INTERRUPTED) {
            if (interruptionReason === undefined) {
                throw new Error("Interrupted plan segments require a reason");
            }
            this.logger.logPlanSegment({
                ...sharedLog,
                event,
                interruptionReason,
            });
            return;
        }
        this.logger.logPlanSegment({
            ...sharedLog,
            event,
        });
    }
    optionSearchOutcome(planStatus) {
        switch (planStatus) {
            case PLAN_BUILD_STATUS.PLANNED:
                return "planned";
            case PLAN_BUILD_STATUS.SATISFIED:
                return "satisfied";
            case PLAN_BUILD_STATUS.COORDINATION_REQUESTED:
                return "coordinating";
            case PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED:
                return "transiently-blocked";
            case PLAN_BUILD_STATUS.INFEASIBLE:
                return "infeasible";
        }
    }
    optionPlanSource(trace, planStatus) {
        if (trace.planningAttempts.some((attempt) => attempt.result === "planned")) {
            return "option";
        }
        if (planStatus === PLAN_BUILD_STATUS.PLANNED
            || planStatus === PLAN_BUILD_STATUS.SATISFIED) {
            return "search";
        }
        return "none";
    }
    findRootTraversability(graph, optionIdentity) {
        return graph?.edges.find((edge) => edge.sourceNodeId === graph.rootNodeId
            && edge.optionIdentity === optionIdentity)?.traversability;
    }
    /** Keeps temporary navigation failures retryable instead of terminating the agent. */
    resolveTemporaryBlockageStatus(planStatus) {
        if (planStatus !== PLAN_BUILD_STATUS.INFEASIBLE
            || this.temporarilyBlockedCells.size === 0) {
            return planStatus;
        }
        return PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED;
    }
    async buildActionsFromDesire(desire, context) {
        const result = await this.buildDesireActionResult(desire, context);
        return result.result === "planned" ? result.actions : undefined;
    }
    /** Continues the evaluated route after a pickup without rerunning the evaluator. */
    async continueSelectedDesireSequence(context = this.getPlanningContext()) {
        const nextDesire = this.selectedDesireSequence[0];
        if (nextDesire === undefined) {
            return false;
        }
        if (nextDesire instanceof VisitCellDesire
            && this.rendezvousCoordinator.isGridFormationEffect(nextDesire.missionId)) {
            return false;
        }
        this.pathfinder.clearPathLengthCache();
        const actionBuild = await this.buildDesireActionResult(nextDesire, context);
        if (actionBuild.result !== "planned") {
            return false;
        }
        this.selectedDesireSequence.shift();
        const intention = new CommittedDesireIntention(nextDesire);
        this.currentIntention = intention;
        this.replacePlan(actionBuild.actions, intention);
        this.logCurrentPlanSegment(PLAN_SEGMENT_EVENT.STARTED);
        return true;
    }
    /** Builds a desire while retaining planner metadata for explainability. */
    async buildDesireActionResult(desire, context) {
        const targetCell = desire.targetCell;
        const navigationContext = {
            ...context,
            cellScoreEffects: context.cellScoreEffects.filter((effect) => !effect.requiresExplicitVisit
                || desire instanceof VisitCellDesire
                    && desire.missionId === effect.id),
        };
        const navigation = await this.buildNavigationActions(targetCell, navigationContext);
        if (navigation === undefined) {
            return {
                result: "rejected",
                reason: "no-executable-route",
                planner: "astar-then-pddl",
            };
        }
        if (desire instanceof PickUpParcelDesire) {
            return {
                result: "planned",
                actions: [
                    ...navigation.actions,
                    context.actionFactory.pickUp(desire.parcelId, context.agentId),
                ],
                planner: navigation.planner,
            };
        }
        if (desire instanceof VisitCellDesire) {
            return {
                result: "planned",
                actions: navigation.actions,
                planner: navigation.planner,
            };
        }
        if (!(desire instanceof DeliverParcelsDesire)) {
            throw new Error(`Unsupported desire type: ${desire.type}`);
        }
        return {
            result: "planned",
            actions: [
                ...navigation.actions,
                ...this.buildDeliveryWaitActions(desire, context),
                context.actionFactory.drop(context.agentId),
            ],
            planner: navigation.planner,
        };
    }
    buildDeliveryWaitActions(desire, context) {
        const actions = [];
        let remainingWaitMilliseconds = desire.waitMilliseconds;
        const maximumWaitStepMilliseconds = Math.max(1, Math.min(context.rewardDecayInterval ?? 1000, 1000));
        while (remainingWaitMilliseconds > 0) {
            const waitStepMilliseconds = Math.min(remainingWaitMilliseconds, maximumWaitStepMilliseconds);
            actions.push(context.actionFactory.wait(waitStepMilliseconds));
            remainingWaitMilliseconds -= waitStepMilliseconds;
        }
        return actions;
    }
    async buildSearchPlan(context) {
        const searchContext = {
            ...context,
            cellScoreEffects: context.cellScoreEffects.filter((effect) => !effect.requiresExplicitVisit),
        };
        this.currentIntention = this.searchIntention;
        const searchActions = this.searchIntention.buildActions(searchContext);
        if (searchActions.length > 0) {
            this.replacePlan(searchActions, this.searchIntention);
            return PLAN_BUILD_STATUS.PLANNED;
        }
        if (this.searchIntention.isSatisfied()) {
            this.replacePlan([], this.searchIntention);
            return PLAN_BUILD_STATUS.SATISFIED;
        }
        const searchTarget = this.searchIntention.target();
        if (!searchTarget) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }
        const navigationActions = await this.buildPddlNavigationActions(searchTarget, searchContext);
        if (navigationActions === undefined) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }
        this.replacePlan(navigationActions, this.searchIntention);
        return PLAN_BUILD_STATUS.PLANNED;
    }
    /** Replaces executable actions together with the intention entitled to completion. */
    replacePlan(actions, owner) {
        this.plan.newPlan(actions);
        this.planOwner = owner;
    }
    /** Notifies only the intention that created the successfully executed plan. */
    completePlan() {
        const completedPlanOwner = this.planOwner;
        this.planOwner = undefined;
        if (completedPlanOwner instanceof ParcelHandoffIntention) {
            this.parcelHandoffCoordinator.completeInstruction(completedPlanOwner.instruction, this.getPlanningContext());
        }
        completedPlanOwner?.onPlanCompleted();
    }
    async buildNavigationActions(targetLocation, context) {
        const directActions = context.pathfinder.findPath(context.gameMap, context.agentPosition, targetLocation, context.crates, context.cellScoreEffects);
        if (directActions.length > 0) {
            return {
                actions: directActions,
                planner: "astar",
            };
        }
        if (context.agentPosition.isEqual(targetLocation)) {
            return {
                actions: directActions,
                planner: "already-at-target",
            };
        }
        const pddlActions = await this.buildPddlNavigationActions(targetLocation, context);
        return pddlActions === undefined
            ? undefined
            : {
                actions: pddlActions,
                planner: "pddl",
            };
    }
    async buildPddlNavigationActions(targetLocation, context) {
        this.pddlPlanner.resetPDDL();
        this.pddlPlanner.buildPDDLProblem(context.gameMap, [...context.crates.values()], context.agentId, context.agentPosition);
        this.pddlPlanner.buildGoal({
            agentId: context.agentId,
            finalTargetPosition: targetLocation,
        });
        const navigationActions = await this.pddlPlanner.solveProblem();
        if (navigationActions === undefined
            || (navigationActions.length === 0
                && !context.agentPosition.isEqual(targetLocation))) {
            return undefined;
        }
        return navigationActions;
    }
    getPlanningContext() {
        return {
            gameMap: this.gameMapWithTemporaryWalls(),
            agentPosition: new Position(this.position.x, this.position.y),
            crates: this.beliefs.crates,
            pickupCells: this.beliefs.pickup_cells,
            pickupCellLastObservedAt: this.beliefs.pickupCellObservationTimes(),
            deliveringCells: this.beliefs.delivering_cells,
            parcels: this.beliefs.parcels,
            pickupExcludedParcelIds: this.parcelHandoffCoordinator.reservedParcelIds(),
            sensedAgents: this.beliefs.agents,
            movementDuration: this.beliefs.movement_duration,
            frameDuration: this.beliefs.frame_duration,
            observationDistance: this.beliefs.observation_distance,
            rewardDecayInterval: this.beliefs.rewardDecayIntervalMilliseconds(),
            millisecondsUntilNextRewardDecay: this.beliefs.millisecondsUntilNextRewardDecay(),
            agentId: this.id,
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
            cellScoreEffects: [
                ...(this.missionHandler?.getActiveMoveToEffects() ?? []),
                ...this.rendezvousCoordinator.activeScoreEffects(),
            ],
            deliveryScoreEffects: this.missionHandler?.getActiveDeliveryScoreEffects() ?? [],
        };
    }
    proposeRendezvous(mission) {
        this.rendezvousCoordinator.propose({
            rendezvousId: mission.getId(),
            reward: mission.reward,
            llmAgentTarget: mission.assignmentFor(RENDEZVOUS_PARTICIPANT.LLM_AGENT).target,
            bdiAgentTarget: mission.assignmentFor(RENDEZVOUS_PARTICIPANT.BDI_AGENT).target,
        });
    }
    considerGridFormation(mission) {
        this.rendezvousCoordinator.considerGridFormation({
            rendezvousId: mission.getId(),
            reward: mission.reward,
            llmAgentObjective: mission.llmAgentObjective,
            bdiAgentObjective: mission.bdiAgentObjective,
        });
    }
    completeRendezvousMissions() {
        return this.completeMissionIds(this.rendezvousCoordinator.consumeCompletedRendezvousIds());
    }
    completeHandoffMissions() {
        return this.completeMissionIds(this.parcelHandoffCoordinator.consumeCompletedHandoffIds());
    }
    completeMissionIds(completedIds) {
        for (const missionId of completedIds) {
            this.missionHandler?.completeMission(missionId);
        }
        return completedIds.length > 0;
    }
    handleHandoffStateChange() {
        if (!this.isHandoffStateChanged) {
            return undefined;
        }
        this.replacePlan([]);
        this.selectedDesireSequence = [];
        const completed = this.completeHandoffMissions();
        this.isHandoffStateChanged = false;
        return completed
            ? DELIBERATION_CYCLE_REASON.HANDOFF_COMPLETED
            : DELIBERATION_CYCLE_REASON.HANDOFF_STATE_CHANGED;
    }
    async handleRendezvousStateChange() {
        if (!this.isRendezvousStateChanged) {
            return undefined;
        }
        const wasWaiting = this.rendezvousCoordinator.isWaitingForPeer();
        this.replacePlan([]);
        this.selectedDesireSequence = [];
        if (wasWaiting) {
            await this.rendezvousCoordinator.waitForPeer();
        }
        const completed = this.completeRendezvousMissions();
        this.isRendezvousStateChanged = false;
        return completed || wasWaiting
            ? DELIBERATION_CYCLE_REASON.RENDEZVOUS_COMPLETED
            : DELIBERATION_CYCLE_REASON.RENDEZVOUS_STATE_CHANGED;
    }
    /** Waits out animated fractional coordinates before discrete path planning. */
    waitForGridPosition() {
        if (this.hasAuthoritativePosition && this.position.isGridAligned()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.gridPositionWaiters.add(resolve);
        });
    }
    addTemporaryBlockedCell(position) {
        if (!position.isGridAligned()) {
            return;
        }
        const key = this.positionKey(position);
        const existing = this.temporarilyBlockedCells.get(key);
        this.temporarilyBlockedCells.set(key, {
            position: new Position(position.x, position.y),
            protectedThroughCycle: Math.max(existing?.protectedThroughCycle ?? 0, this.deliberationCycle + 1),
        });
    }
    refreshTemporaryBlockedCells() {
        for (const [key, blockedCell] of this.temporarilyBlockedCells) {
            if (blockedCell.protectedThroughCycle >= this.deliberationCycle) {
                continue;
            }
            if (!this.beliefs.isPositionCurrentlyObserved(blockedCell.position)) {
                continue;
            }
            const occupied = [...this.beliefs.agents.values()].some((agent) => Math.round(agent.x) === blockedCell.position.x
                && Math.round(agent.y) === blockedCell.position.y);
            if (!occupied) {
                this.temporarilyBlockedCells.delete(key);
            }
        }
    }
    gameMapWithTemporaryWalls() {
        if (this.temporarilyBlockedCells.size === 0) {
            return this.beliefs.map;
        }
        // Extract raw map data from GameMap and create a copy
        const mapCopy = [];
        for (let row = 0; row < this.beliefs.map.getRows(); row++) {
            mapCopy[row] = [];
            for (let col = 0; col < this.beliefs.map.getCols(); col++) {
                const cellPos = new Position(row, col);
                mapCopy[row][col] = this.beliefs.map.getCellValue(cellPos);
            }
        }
        // Apply temporary blocked cells to the copy
        for (const blockedCell of this.temporarilyBlockedCells.values()) {
            const { position } = blockedCell;
            if (!position.isGridAligned()) {
                continue;
            }
            const row = mapCopy[position.x];
            if (row === undefined
                || position.y < 0
                || position.y >= row.length) {
                continue;
            }
            row[position.y] = "0";
        }
        // Return a new GameMap with the modified data
        return new GameMap(mapCopy);
    }
    /** Copies a planning map while reserving one coordination cell as a wall. */
    gameMapWithAdditionalWall(gameMap, blockedPosition) {
        const mapCopy = gameMap.getTiles().map((row) => [...row]);
        if (!gameMap.isValidCoordinates(blockedPosition)) {
            return gameMap;
        }
        mapCopy[blockedPosition.x][blockedPosition.y] = "0";
        return new GameMap(mapCopy);
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
    signalBeliefChanged() {
        this.isBeliefChanged = true;
    }
    /** Signals only changes that can invalidate the active evaluated route. */
    signalBeliefRevision(revision) {
        const relevantChanges = revision.changes.filter((change) => this.isPlanningRelevantBeliefChange(change));
        if (relevantChanges.length === 0) {
            return;
        }
        if (relevantChanges.every((change) => this.isOwnPickupCarrierChange(change))) {
            return;
        }
        this.pendingBeliefChanges.push(...relevantChanges);
        this.signalBeliefChanged();
    }
    /** Reward changes are forecast; disappearance immediately invalidates plans. */
    isPlanningRelevantBeliefChange(change) {
        return change.type !== BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED;
    }
    consumePendingBeliefChanges() {
        const changes = this.pendingBeliefChanges;
        this.pendingBeliefChanges = [];
        return changes;
    }
    isOwnPickupCarrierChange(change) {
        return change.type === BELIEF_CHANGE_TYPE.PARCEL_CARRIER_CHANGED
            && change.previousCarrier === undefined
            && change.currentCarrier === this.id;
    }
}
//# sourceMappingURL=agent.js.map