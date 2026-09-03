import type { Beliefs } from "./bdi/beliefs.js";
import {
    BELIEF_CHANGE_TYPE,
    type BeliefChange,
    type BeliefRevision
} from "./bdi/beliefs.js";
import {
    DeliverParcelsDesire,
    Desire,
    DesireGenerator,
    PickUpParcelDesire,
    VisitCellDesire,
} from "./bdi/desires.js";
import { CommittedDesireIntention, Intention, PickupClusterSnapshot, SearchIntention } from "./bdi/intentions.js";
import { OPTION_TRAVERSABILITY, OptionEvaluationGraph, OptionEvaluator } from "./bdi/option_evaluator.js";
import type { Mission } from "./llm/mission.js";
import { MissionHandler } from "./llm/MissionHandler.js";
import { PDDLPlanner } from "./pddl/pddlPlanner.js";
import {
    type PlanningContext,
    type PlanningObjectiveDescription,
} from "./planning.js";
import {
    type BaseAgentLogger,
    type BranchAndBoundLog,
    DELIBERATION_CYCLE_REASON,
    type OptionPlanAttemptLog,
    type OptionPlanMethod,
    type OptionSearchOutcome,
    PLAN_SEGMENT_EVENT,
} from "./utils/_logging.js";
import type { BasePathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import {
    Action,
    type ActionFactory,
    Drop,
    MovementAction,
    PickUp,
} from "./utils/move.js";
import { Plan } from "./utils/plan.js";
import { Position } from "./utils/position.js";

interface TemporaryBlockedCell {
    readonly position: Position;
    readonly protectedThroughCycle: number;
}

interface OptionSearchTrace {
    readonly evaluationPasses: OptionEvaluationGraph[];
    readonly planningAttempts: OptionPlanAttemptLog[];
}

interface NavigationBuildResult {
    readonly actions: Action[];
    readonly planner: OptionPlanMethod;
}

type DesireActionBuildResult =
    | {
        readonly result: "planned";
        readonly actions: Action[];
        readonly planner: OptionPlanMethod;
    }
    | {
        readonly result: "rejected";
        readonly reason: "no-executable-route";
        readonly planner: OptionPlanMethod;
    };

/** Terminal reasons for which the otherwise continuous agent loop can stop. */
export enum AGENT_EXIT_REASON {
    NO_FEASIBLE_PLAN = "no-feasible-plan",
}

/** Outcome of one complete planning pass across options and search fallback. */
export enum PLAN_BUILD_STATUS {
    PLANNED = "planned",
    SATISFIED = "satisfied",
    TRANSIENTLY_BLOCKED = "transiently-blocked",
    INFEASIBLE = "infeasible",
}

/** Coordinates option evaluation, exploration fallback, planning, and execution. */
export class Agent {
    id: string;
    readonly position: Position;

    // LLM local variables
    private readonly useLLM: boolean;
    private readonly missionHandler: MissionHandler | undefined;

    private score: number | undefined;
    private currentIntention: Intention;
    private selectedDesireSequence: Desire[];
    private isBeliefChanged: boolean;
    private pendingBeliefChanges: BeliefChange[];
    private readonly optionEvaluator: OptionEvaluator;
    private readonly searchIntention: SearchIntention;
    private readonly plan: Plan;
    private planOwner: Intention | undefined;
    private readonly temporarilyBlockedCells: Map<string, TemporaryBlockedCell>;
    private readonly gridPositionWaiters: Set<() => void>;
    private hasAuthoritativePosition: boolean;
    private deliberationCycle: number;

    private readonly pddlPlanner: PDDLPlanner;

    constructor(
        private readonly beliefs: Beliefs,
        desireGenerator: DesireGenerator,
        private readonly pathfinder: BasePathfinder,
        private readonly actionFactory: ActionFactory,
        private readonly logger: BaseAgentLogger,
        useLLM: boolean = false,
        llmMissionHandler: MissionHandler | undefined = undefined,
    ) {
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
        this.temporarilyBlockedCells = new Map<string, TemporaryBlockedCell>();
        this.gridPositionWaiters = new Set<() => void>();
        this.hasAuthoritativePosition = false;
        this.deliberationCycle = 0;
        this.pddlPlanner = new PDDLPlanner(this.actionFactory);
        this.optionEvaluator = new OptionEvaluator(desireGenerator);
    }

    updatePosition(x: number, y: number): void {
        this.position.x = x;
        this.position.y = y;
        this.hasAuthoritativePosition = true;
        if (!this.position.isGridAligned()) {
            return;
        }

        const waiters = [...this.gridPositionWaiters];
        this.gridPositionWaiters.clear();
        for (const resolve of waiters) {
            resolve();
        }
    }

    /** Applies an authoritative score update and reports newly awarded points. */
    updateScore(score: number): void {
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
    currentDecision(): PlanningObjectiveDescription {
        return this.currentIntention.describe();
    }

    /** Exposes temporary navigation walls without leaking the mutable map. */
    temporaryBlockedCellSnapshots(): readonly Position[] {
        return [...this.temporarilyBlockedCells.values()].map(
            (blockedCell: TemporaryBlockedCell): Position =>
                new Position(
                    blockedCell.position.x,
                    blockedCell.position.y,
                ),
        );
    }

    /** Exposes the search intention's persistent cluster visit history. */
    pickupClusterSnapshots(): readonly PickupClusterSnapshot[] {
        return this.searchIntention.clusterSnapshots(
            this.beliefs.pickup_cells,
            this.beliefs.pickupCellObservationTimes(),
        );
    }

    currentScore(): number | undefined {
        return this.score;
    }

    currentDeliberationCycle(): number {
        return this.deliberationCycle;
    }

    usesLLM(): boolean {
        return this.useLLM;
    }

    handleMsgFromChat(senderId: string, senderName: string, msg: string): void {
        if(!this.useLLM)
            return;

        this.logger.logMissionReceived({ senderName, message: msg });
        this.missionHandler?.addPendingMission(senderId, senderName, msg);
    }

    /** Continuously selects and executes the most valuable available intention. */
    async agent_loop(): Promise<AGENT_EXIT_REASON> {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));

        let deliberateImmediately = false;
        let nextCycleReason = DELIBERATION_CYCLE_REASON.AGENT_STARTED;
        while (true) {
            if (!deliberateImmediately) {
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );
            }
            deliberateImmediately = false;
            const cycleReason = nextCycleReason;
            nextCycleReason = DELIBERATION_CYCLE_REASON.PLAN_COMPLETED;
            const cycleBeliefChanges = cycleReason
                === DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED
                ? this.consumePendingBeliefChanges()
                : [];

            await this.waitForGridPosition();

            if(this.useLLM) {
                if (this.missionHandler?.isMissionWaiting()){
                    const missions: readonly Mission[] =
                        await this.missionHandler.evaluateMission(
                            this.getPlanningContext(),
                    );
                    for (const mission of missions) {
                        this.logger.logMissionActivated(mission.describe());
                    }
                }

                this.missionHandler?.completeMoveToMissionsAt(this.position);
            }


            this.deliberationCycle += 1;
            this.refreshTemporaryBlockedCells();
            this.beliefs.updateParcelRewards();
            this.pathfinder.clearPathLengthCache();
            const context = this.getPlanningContext();

            const initialOptionEvaluation =
                this.optionEvaluator.evaluateWithGraph(context);
            this.selectedDesireSequence = initialOptionEvaluation.bestSequence;
            const optionSearchTrace: OptionSearchTrace = {
                evaluationPasses: [initialOptionEvaluation.graph],
                planningAttempts: [],
            };

            const planStatus = await this.buildPlanWithTrace(
                context,
                optionSearchTrace,
            );
            this.logOptionSearch(
                context,
                optionSearchTrace,
                planStatus,
                cycleReason,
                cycleBeliefChanges,
            );

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
                if (
                    this.isBeliefChanged
                ) {
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
                await new Promise<void>((resolve) =>
                    setTimeout(
                        resolve,
                        nextAction.executionDelayMilliseconds(
                            this.beliefs.movement_duration,
                        ),
                    )
                );

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
                    this.missionHandler?.completeMoveToMissionsAt(
                        movementDestination,
                    );
                }
                if (
                    nextAction instanceof Drop
                    && nextAction.deliveredParcels()
                ) {
                    this.missionHandler?.completeDropAtMissionsAt(
                        this.position,
                    );
                }

                if (this.plan.isEmpty()) {
                    this.logCurrentPlanSegment(PLAN_SEGMENT_EVENT.COMPLETED);
                }

                if (
                    this.plan.isEmpty()
                    && this.selectedDesireSequence.length > 0
                ) {
                    if (
                        nextAction instanceof PickUp
                        && !this.isBeliefChanged
                        && await this.continueSelectedDesireSequence()
                    ) {
                        continue;
                    }
                    this.selectedDesireSequence = [];
                    deliberateImmediately = true;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.OPTION_SEGMENT_COMPLETED;
                }
            }

            if (planInterrupted) {
                this.logCurrentPlanSegment(
                    PLAN_SEGMENT_EVENT.INTERRUPTED,
                    nextCycleReason,
                );
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

    async buildPlan(
        context: PlanningContext = this.getPlanningContext(),
    ): Promise<PLAN_BUILD_STATUS> {
        return this.buildPlanWithTrace(context);
    }

    /** Builds a plan and optionally records each evaluator and planner decision. */
    private async buildPlanWithTrace(
        context: PlanningContext,
        optionSearchTrace?: OptionSearchTrace,
    ): Promise<PLAN_BUILD_STATUS> {
        const rejectedRootOptionIdentities = new Set<string>();

        while (this.selectedDesireSequence.length > 0) {
            const bestDesire = this.selectedDesireSequence[0];
            const actionBuild = await this.buildDesireActionResult(
                bestDesire,
                context,
            );
            const estimatedTraversability = optionSearchTrace
                ? this.findRootTraversability(
                    optionSearchTrace.evaluationPasses[
                        optionSearchTrace.evaluationPasses.length - 1
                    ],
                    bestDesire.identity(),
                )
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
            const fallbackEvaluation = this.optionEvaluator.evaluateWithGraph(
                context,
                rejectedRootOptionIdentities,
            );
            this.selectedDesireSequence = fallbackEvaluation.bestSequence;
            optionSearchTrace?.evaluationPasses.push(fallbackEvaluation.graph);
        }

        return this.resolveTemporaryBlockageStatus(
            await this.buildSearchPlan(context),
        );
    }

    /** Emits the evaluator graph together with real A-star/PDDL validation outcomes. */
    private logOptionSearch(
        context: PlanningContext,
        trace: OptionSearchTrace,
        planStatus: PLAN_BUILD_STATUS,
        cycleReason: DELIBERATION_CYCLE_REASON,
        beliefChanges: readonly BeliefChange[],
    ): void {
        const log: BranchAndBoundLog = {
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
            nextExecutableObjective: this.currentIntention.describe(),
        };
        this.logger.logBranchAndBound(log);
    }

    private logCurrentPlanSegment(
        event:
            | PLAN_SEGMENT_EVENT.STARTED
            | PLAN_SEGMENT_EVENT.COMPLETED,
    ): void;
    private logCurrentPlanSegment(
        event: PLAN_SEGMENT_EVENT.INTERRUPTED,
        interruptionReason: DELIBERATION_CYCLE_REASON,
    ): void;
    private logCurrentPlanSegment(
        event: PLAN_SEGMENT_EVENT,
        interruptionReason?: DELIBERATION_CYCLE_REASON,
    ): void {
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

    private optionSearchOutcome(
        planStatus: PLAN_BUILD_STATUS,
    ): OptionSearchOutcome {
        switch (planStatus) {
            case PLAN_BUILD_STATUS.PLANNED:
                return "planned";
            case PLAN_BUILD_STATUS.SATISFIED:
                return "satisfied";
            case PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED:
                return "transiently-blocked";
            case PLAN_BUILD_STATUS.INFEASIBLE:
                return "infeasible";
        }
    }

    private optionPlanSource(
        trace: OptionSearchTrace,
        planStatus: PLAN_BUILD_STATUS,
    ): "option" | "search" | "none" {
        if (trace.planningAttempts.some(
            (attempt: OptionPlanAttemptLog): boolean =>
                attempt.result === "planned",
        )) {
            return "option";
        }
        if (
            planStatus === PLAN_BUILD_STATUS.PLANNED
            || planStatus === PLAN_BUILD_STATUS.SATISFIED
        ) {
            return "search";
        }
        return "none";
    }

    private findRootTraversability(
        graph: OptionEvaluationGraph | undefined,
        optionIdentity: string,
    ): OPTION_TRAVERSABILITY | undefined {
        return graph?.edges.find(
            (edge): boolean => edge.sourceNodeId === graph.rootNodeId
                && edge.optionIdentity === optionIdentity,
        )?.traversability;
    }

    /** Keeps temporary navigation failures retryable instead of terminating the agent. */
    private resolveTemporaryBlockageStatus(
        planStatus: PLAN_BUILD_STATUS,
    ): PLAN_BUILD_STATUS {
        if (
            planStatus !== PLAN_BUILD_STATUS.INFEASIBLE
            || this.temporarilyBlockedCells.size === 0
        ) {
            return planStatus;
        }

        return PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED;
    }

    private async buildActionsFromDesire(
        desire: Desire,
        context: PlanningContext,
    ): Promise<Action[] | undefined> {
        const result = await this.buildDesireActionResult(desire, context);
        return result.result === "planned" ? result.actions : undefined;
    }

    /** Continues the evaluated route after a pickup without rerunning the evaluator. */
    private async continueSelectedDesireSequence(
        context: PlanningContext = this.getPlanningContext(),
    ): Promise<boolean> {
        const nextDesire = this.selectedDesireSequence[0];
        if (nextDesire === undefined) {
            return false;
        }

        this.pathfinder.clearPathLengthCache();
        const actionBuild = await this.buildDesireActionResult(
            nextDesire,
            context,
        );
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
    private async buildDesireActionResult(
        desire: Desire,
        context: PlanningContext,
    ): Promise<DesireActionBuildResult> {
        const targetCell = desire.targetCell;
        const navigation = await this.buildNavigationActions(
            targetCell,
            context,
        );
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

    private buildDeliveryWaitActions(
        desire: DeliverParcelsDesire,
        context: PlanningContext,
    ): Action[] {
        const actions: Action[] = [];
        let remainingWaitMilliseconds = desire.waitMilliseconds;
        const maximumWaitStepMilliseconds = Math.max(
            1,
            Math.min(context.rewardDecayInterval ?? 1_000, 1_000),
        );
        while (remainingWaitMilliseconds > 0) {
            const waitStepMilliseconds = Math.min(
                remainingWaitMilliseconds,
                maximumWaitStepMilliseconds,
            );
            actions.push(
                context.actionFactory.wait(waitStepMilliseconds),
            );
            remainingWaitMilliseconds -= waitStepMilliseconds;
        }
        return actions;
    }

    private async buildSearchPlan(
        context: PlanningContext,
    ): Promise<PLAN_BUILD_STATUS> {
        this.currentIntention = this.searchIntention;
        const searchActions = this.searchIntention.buildActions(context);
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
        const navigationActions = await this.buildPddlNavigationActions(
            searchTarget,
            context,
        );
        if (navigationActions === undefined) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }

        this.replacePlan(navigationActions, this.searchIntention);
        return PLAN_BUILD_STATUS.PLANNED;
    }

    /** Replaces executable actions together with the intention entitled to completion. */
    private replacePlan(actions: Action[], owner?: Intention): void {
        this.plan.newPlan(actions);
        this.planOwner = owner;
    }

    /** Notifies only the intention that created the successfully executed plan. */
    private completePlan(): void {
        const completedPlanOwner = this.planOwner;
        this.planOwner = undefined;
        completedPlanOwner?.onPlanCompleted();
    }

    private async buildNavigationActions(
        targetLocation: Position,
        context: PlanningContext,
    ): Promise<NavigationBuildResult | undefined> {
        const directActions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            targetLocation,
            context.crates,
            context.cellScoreEffects,
        );
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

        const pddlActions = await this.buildPddlNavigationActions(
            targetLocation,
            context,
        );
        return pddlActions === undefined
            ? undefined
            : {
                actions: pddlActions,
                planner: "pddl",
            };
    }

    private async buildPddlNavigationActions(
        targetLocation: Position,
        context: PlanningContext,
    ): Promise<Action[] | undefined> {
        this.pddlPlanner.resetPDDL();
        this.pddlPlanner.buildPDDLProblem(
            context.gameMap,
            [...context.crates.values()],
            context.agentId,
            context.agentPosition,
        );
        this.pddlPlanner.buildGoal({
            agentId: context.agentId,
            finalTargetPosition: targetLocation,
        });

        const navigationActions = await this.pddlPlanner.solveProblem();
        if (
            navigationActions === undefined
            || (
                navigationActions.length === 0
                && !context.agentPosition.isEqual(targetLocation)
            )
        ) {
            return undefined;
        }

        return navigationActions;
    }

    private getPlanningContext(): PlanningContext {
        return {
            gameMap: this.gameMapWithTemporaryWalls(),
            agentPosition: new Position(this.position.x, this.position.y),
            crates: this.beliefs.crates,
            pickupCells: this.beliefs.pickup_cells,
            pickupCellLastObservedAt: this.beliefs.pickupCellObservationTimes(),
            deliveringCells: this.beliefs.delivering_cells,
            parcels: this.beliefs.parcels,
            movementDuration: this.beliefs.movement_duration,
            frameDuration: this.beliefs.frame_duration,
            observationDistance: this.beliefs.observation_distance,
            rewardDecayInterval:
                this.beliefs.rewardDecayIntervalMilliseconds(),
            millisecondsUntilNextRewardDecay:
                this.beliefs.millisecondsUntilNextRewardDecay(),
            agentId: this.id,
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
            cellScoreEffects:
                this.missionHandler?.getActiveMoveToEffects() ?? [],
            deliveryScoreEffects:
                this.missionHandler?.getActiveDeliveryScoreEffects() ?? [],
        };
    }

    /** Waits out animated fractional coordinates before discrete path planning. */
    private waitForGridPosition(): Promise<void> {
        if (this.hasAuthoritativePosition && this.position.isGridAligned()) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve: () => void): void => {
            this.gridPositionWaiters.add(resolve);
        });
    }

    private addTemporaryBlockedCell(position: Position): void {
        const key = this.positionKey(position);
        const existing = this.temporarilyBlockedCells.get(key);
        this.temporarilyBlockedCells.set(key, {
            position: new Position(position.x, position.y),
            protectedThroughCycle: Math.max(
                existing?.protectedThroughCycle ?? 0,
                this.deliberationCycle + 1,
            ),
        });
    }

    private refreshTemporaryBlockedCells(): void {
        for (const [key, blockedCell] of this.temporarilyBlockedCells) {
            if (blockedCell.protectedThroughCycle >= this.deliberationCycle) {
                continue;
            }
            if (!this.beliefs.isPositionCurrentlyObserved(blockedCell.position)) {
                continue;
            }
            const occupied = [...this.beliefs.agents.values()].some(
                (agent): boolean => Math.round(agent.x) === blockedCell.position.x
                    && Math.round(agent.y) === blockedCell.position.y,
            );
            if (!occupied) {
                this.temporarilyBlockedCells.delete(key);
            }
        }
    }

    private gameMapWithTemporaryWalls(): GameMap {
        if (this.temporarilyBlockedCells.size === 0) {
            return this.beliefs.map;
        }

        // Extract raw map data from GameMap and create a copy
        const mapCopy: string[][] = [];
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
            if (
                position.x >= 0
                && position.x < mapCopy.length
                && position.y >= 0
                && position.y < mapCopy[position.x].length
            ) {
                mapCopy[position.x][position.y] = "0";
            }
        }

        // Return a new GameMap with the modified data
        return new GameMap(mapCopy);
    }

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }

    signalBeliefChanged(): void {
        this.isBeliefChanged = true;
    }

    /** Signals only changes that can invalidate the active evaluated route. */
    signalBeliefRevision(revision: BeliefRevision): void {
        const relevantChanges = revision.changes.filter(
            (change: BeliefChange): boolean =>
                this.isPlanningRelevantBeliefChange(change),
        );
        if (relevantChanges.length === 0) {
            return;
        }

        if (
            relevantChanges.every(
                (change: BeliefChange): boolean =>
                    this.isOwnPickupCarrierChange(change),
            )
        ) {
            return;
        }

        this.pendingBeliefChanges.push(...relevantChanges);
        this.signalBeliefChanged();
    }

    /** Reward changes are forecast; disappearance immediately invalidates plans. */
    private isPlanningRelevantBeliefChange(change: BeliefChange): boolean {
        return change.type !== BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED;
    }

    private consumePendingBeliefChanges(): BeliefChange[] {
        const changes = this.pendingBeliefChanges;
        this.pendingBeliefChanges = [];
        return changes;
    }

    private isOwnPickupCarrierChange(change: BeliefChange): boolean {
        return change.type === BELIEF_CHANGE_TYPE.PARCEL_CARRIER_CHANGED
            && change.previousCarrier === undefined
            && change.currentCarrier === this.id;
    }
}
