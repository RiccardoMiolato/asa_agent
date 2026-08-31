import {
    type BaseAgentLogger,
    type BeliefLogSummary,
    type BranchAndBoundLog,
    DELIBERATION_CYCLE_REASON,
    type IntentionLogEntry,
    type OptionPlanAttemptLog,
    type OptionPlanMethod,
    type OptionSearchOutcome,
} from "./_logging.js";
import type { BasePathfinder } from "./astar.js";
import {
    BELIEF_CHANGE_TYPE,
    type BeliefChange,
    type BeliefRevision,
    type Beliefs,
} from "./beliefs.js";
import type { IntentionGenerator } from "./desires.js";
import {
    Intention,
    SearchIntention,
    type IntentionContext,
    type IntentionDescription,
    type PickupClusterSnapshot,
} from "./intentions.js";
import { GameMap } from "./map.js";
import {
    Action,
    MovementAction,
    PickUp,
    type ActionFactory,
} from "./move.js";
import { ConservativeMovementGuard } from "./movement-safety.js";
import {
    OPTION_TRAVERSABILITY,
    Option,
    OptionEvaluator,
    type OptionEvaluationGraph,
} from "./option_evaluator.js";
import { PDDLPlanner } from "./pddl/pddlPlanner.js";
import { Plan } from "./plan.js";
import { Position } from "./position.js";

interface ScoredIntention {
    readonly intention: Intention;
    readonly score: number;
    readonly distance: number | undefined;
}

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

type OptionActionBuildResult =
    | {
        readonly result: "planned";
        readonly actions: Action[];
        readonly planner: OptionPlanMethod;
    }
    | {
        readonly result: "rejected";
        readonly reason: "no-executable-route" | "missing-parcel-id";
        readonly planner: OptionPlanMethod;
    };

/** Terminal reasons for which the otherwise continuous agent loop can stop. */
export enum AGENT_EXIT_REASON {
    NO_FEASIBLE_PLAN = "no-feasible-plan",
}

/** Outcome of one complete planning pass across the available intentions. */
export enum PLAN_BUILD_STATUS {
    PLANNED = "planned",
    SATISFIED = "satisfied",
    TRANSIENTLY_BLOCKED = "transiently-blocked",
    INFEASIBLE = "infeasible",
}

/** Coordinates intention generation, selection, planning, and execution. */
export class Agent {
    id: string;
    readonly position: Position;

    private score: number | undefined;
    private intentions: Intention[];
    private currentIntention: Intention;
    private currentOptionsList: Option[];
    private isBeliefChanged: boolean;
    private pendingBeliefChanges: BeliefChange[];
    private readonly optionEvaluator: OptionEvaluator;
    private readonly plan: Plan;
    private planOwner: Intention | undefined;
    private readonly movementGuard: ConservativeMovementGuard;
    private readonly temporarilyBlockedCells: Map<string, TemporaryBlockedCell>;
    private readonly gridPositionWaiters: Set<() => void>;
    private hasAuthoritativePosition: boolean;
    private deliberationCycle: number;

    private readonly pddlPlanner: PDDLPlanner;

    constructor(
        private readonly beliefs: Beliefs,
        private readonly intentionGenerator: IntentionGenerator,
        private readonly pathfinder: BasePathfinder,
        private readonly actionFactory: ActionFactory,
        private readonly logger: BaseAgentLogger,
        pddlPlanner?: PDDLPlanner,
    ) {
        this.id = "";
        this.position = new Position(0, 0);
        this.score = undefined;
        this.intentions = [];
        this.isBeliefChanged = false;
        this.pendingBeliefChanges = [];
        this.currentOptionsList = [];
        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
        this.planOwner = undefined;
        this.movementGuard = new ConservativeMovementGuard(
            this.beliefs,
            this.logger,
        );
        this.temporarilyBlockedCells = new Map<string, TemporaryBlockedCell>();
        this.gridPositionWaiters = new Set<() => void>();
        this.hasAuthoritativePosition = false;
        this.deliberationCycle = 0;
        this.pddlPlanner = pddlPlanner ?? new PDDLPlanner(this.actionFactory);
        this.optionEvaluator = new OptionEvaluator();
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
    currentDecision(): IntentionDescription {
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
        return this.intentionGenerator.pickupClusterSnapshots();
    }

    currentScore(): number | undefined {
        return this.score;
    }

    currentDeliberationCycle(): number {
        return this.deliberationCycle;
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

            this.deliberationCycle += 1;
            this.refreshTemporaryBlockedCells();
            this.beliefs.updateParcelRewards();
            this.pathfinder.clearPathLengthCache();
            const context = this.getIntentionContext();

            const initialOptionEvaluation =
                this.optionEvaluator.evaluateWithGraph(context);
            this.currentOptionsList = initialOptionEvaluation.bestSequence;
            const optionSearchTrace: OptionSearchTrace = {
                evaluationPasses: [initialOptionEvaluation.graph],
                planningAttempts: [],
            };

            // const evaluatedOptions = this.filterOptions(context);
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

            /**
             * const options = this.intentionGenerator.generate({
             *      id: this.id,
             *      position: context.agentPosition,
             *  });
             *  this.addIntentions(options);
             *  this.pathfinder.clearPathLengthCache();
             *
             * const plannedCrateRevision = this.beliefs.currentCrateRevision();
             *
             * this.logger.logDeliberation({
             *     cycle: this.deliberationCycle,
             *     agentId: this.id,
             *     agentScore: this.score,
             *     position: context.agentPosition,
             *     beliefs: this.makeBeliefLogSummary(),
             *     options: this.makeOptionLogEntries(
             *         evaluatedOptions,
             *         planStatus === PLAN_BUILD_STATUS.PLANNED
             *         || planStatus === PLAN_BUILD_STATUS.SATISFIED,
             *     ),
             *     plannedActions: this.plan.size(),
             * });
             */

            if (planStatus === PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED) {
                nextCycleReason =
                    DELIBERATION_CYCLE_REASON.TRANSIENT_BLOCKAGE_RETRY;
                continue;
            }
            if (planStatus === PLAN_BUILD_STATUS.INFEASIBLE) {
                return AGENT_EXIT_REASON.NO_FEASIBLE_PLAN;
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

                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );

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

                const movementDestination = nextAction instanceof MovementAction
                    ? nextAction.destinationFrom(this.position)
                    : undefined;
                if (movementDestination) {
                    const clearance = await this.movementGuard.waitUntilSafe(
                        movementDestination,
                    );
                    if (clearance.decision === "replan") {
                        this.addTemporaryBlockedCell(clearance.blockedCell);
                        deliberateImmediately = true;
                        planInterrupted = true;
                        nextCycleReason =
                            DELIBERATION_CYCLE_REASON.MOVEMENT_SAFETY_REPLAN;
                        break;
                    }
                }

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
                }

                if (this.plan.isEmpty() && this.currentOptionsList.length > 0) {
                    if (
                        nextAction instanceof PickUp
                        && !this.isBeliefChanged
                        && await this.continueSelectedOptionSequence()
                    ) {
                        continue;
                    }
                    this.currentOptionsList = [];
                    deliberateImmediately = true;
                    nextCycleReason =
                        DELIBERATION_CYCLE_REASON.OPTION_SEGMENT_COMPLETED;
                }
            }

            if (planInterrupted) {
                this.planOwner = undefined;
            }
            if (!planInterrupted && this.plan.isEmpty()) {
                this.completePlan(this.getIntentionContext());
                if (planMoved) {
                    this.temporarilyBlockedCells.clear();
                }
            }
        }
    }

    getIntentions(): readonly Intention[] {
        return this.intentions;
    }

    addIntention(intention: Intention): void {
        this.intentions.push(intention);
    }

    addIntentions(intentions: Intention[]): void {
        this.intentions = intentions;
    }

    clearIntentions(): void {
        this.intentions = [];
    }

    /** Scores each option once and ranks them by score, then distance. */
    filterOptions(context: IntentionContext = this.getIntentionContext()): ScoredIntention[] {
        const fallback = this.intentions.find(
            (intention: Intention): boolean => intention instanceof SearchIntention,
        ) ?? new SearchIntention();
        let bestOption: Intention = fallback;
        let bestScore = fallback.score(context);
        let bestDistance = fallback.selectionDistance(context);
        const scoredIntentions: ScoredIntention[] = [{
            intention: fallback,
            score: bestScore,
            distance: bestDistance,
        }];

        for (const intention of this.intentions) {
            if (intention === fallback) {
                continue;
            }
            const score = intention.score(context);
            const distance = intention.selectionDistance(context);
            scoredIntentions.push({ intention, score, distance });
            const closerEqualScore = score === bestScore
                && (distance ?? Number.POSITIVE_INFINITY)
                < (bestDistance ?? Number.POSITIVE_INFINITY);
            if (score > bestScore || closerEqualScore) {
                bestScore = score;
                bestDistance = distance;
                bestOption = intention;
            }
        }

        this.currentIntention = bestOption;
        return scoredIntentions.sort(
            (first: ScoredIntention, second: ScoredIntention): number => {
                const scoreDifference = second.score - first.score;
                if (scoreDifference !== 0) {
                    return scoreDifference;
                }
                return (first.distance ?? Number.POSITIVE_INFINITY)
                    - (second.distance ?? Number.POSITIVE_INFINITY);
            },
        );
    }

    /** Tries every ranked option for a plan and preserves all-satisfied idling. */
    private async buildBestAvailablePlan(
        rankedIntentions: readonly ScoredIntention[],
        context: IntentionContext,
    ): Promise<PLAN_BUILD_STATUS> {
        let satisfiedIntention: Intention | undefined;
        let infeasibleIntentionFound = false;

        for (const { intention } of rankedIntentions) {
            this.currentIntention = intention;
            const planStatus = await this.buildPlan(context);
            if (planStatus === PLAN_BUILD_STATUS.PLANNED) {
                return PLAN_BUILD_STATUS.PLANNED;
            }
            if (planStatus === PLAN_BUILD_STATUS.SATISFIED) {
                satisfiedIntention ??= intention;
                continue;
            }
            infeasibleIntentionFound = true;
        }

        this.replacePlan([]);
        if (this.temporarilyBlockedCells.size > 0) {
            if (satisfiedIntention) {
                this.currentIntention = satisfiedIntention;
            }
            return PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED;
        }
        if (infeasibleIntentionFound || !satisfiedIntention) {
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }

        this.currentIntention = satisfiedIntention;
        return PLAN_BUILD_STATUS.SATISFIED;
    }

    async buildPlan(
        context: IntentionContext = this.getIntentionContext(),
    ): Promise<PLAN_BUILD_STATUS> {
        return this.buildPlanWithTrace(context);
    }

    /** Builds a plan and optionally records each evaluator and planner decision. */
    private async buildPlanWithTrace(
        context: IntentionContext,
        optionSearchTrace?: OptionSearchTrace,
    ): Promise<PLAN_BUILD_STATUS> {
        const rejectedRootOptionIdentities = new Set<string>();

        while (this.currentOptionsList.length > 0) {
            const bestOption = this.currentOptionsList[0];
            const actionBuild = await this.buildOptionActionResult(
                bestOption,
                context,
            );
            const estimatedTraversability = optionSearchTrace
                ? this.findRootTraversability(
                    optionSearchTrace.evaluationPasses[
                        optionSearchTrace.evaluationPasses.length - 1
                    ],
                    bestOption.identity(),
                )
                : undefined;
            optionSearchTrace?.planningAttempts.push({
                optionIdentity: bestOption.identity(),
                optionType: bestOption.getType(),
                parcelId: bestOption.getParcelId(),
                targetPosition: bestOption.getTargetCell(),
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
                this.currentOptionsList.shift();
                this.replacePlan(actionBuild.actions);
                return PLAN_BUILD_STATUS.PLANNED;
            }

            rejectedRootOptionIdentities.add(bestOption.identity());
            const fallbackEvaluation = this.optionEvaluator.evaluateWithGraph(
                context,
                rejectedRootOptionIdentities,
            );
            this.currentOptionsList = fallbackEvaluation.bestSequence;
            optionSearchTrace?.evaluationPasses.push(fallbackEvaluation.graph);
        }

        return this.resolveTemporaryBlockageStatus(
            await this.buildSearchPlan(context),
        );
    }

    /** Emits the evaluator graph together with real A-star/PDDL validation outcomes. */
    private logOptionSearch(
        context: IntentionContext,
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
        };
        this.logger.logBranchAndBound(log);
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

    private async buildActionsFromOption(
        option: Option,
        context: IntentionContext,
    ): Promise<Action[] | undefined> {
        const result = await this.buildOptionActionResult(option, context);
        return result.result === "planned" ? result.actions : undefined;
    }

    /** Continues the evaluated route after a pickup without rerunning the evaluator. */
    private async continueSelectedOptionSequence(
        context: IntentionContext = this.getIntentionContext(),
    ): Promise<boolean> {
        const nextOption = this.currentOptionsList[0];
        if (nextOption === undefined) {
            return false;
        }

        this.pathfinder.clearPathLengthCache();
        const actionBuild = await this.buildOptionActionResult(
            nextOption,
            context,
        );
        if (actionBuild.result !== "planned") {
            return false;
        }

        this.currentOptionsList.shift();
        this.replacePlan(actionBuild.actions);
        return true;
    }

    /** Builds an option while retaining planner metadata for explainability. */
    private async buildOptionActionResult(
        option: Option,
        context: IntentionContext,
    ): Promise<OptionActionBuildResult> {
        const targetCell = option.getTargetCell();
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

        if (option.getType() === "pick") {
            const parcelId = option.getParcelId();
            if (parcelId === undefined) {
                return {
                    result: "rejected",
                    reason: "missing-parcel-id",
                    planner: navigation.planner,
                };
            }
            return {
                result: "planned",
                actions: [
                    ...navigation.actions,
                    context.actionFactory.pickUp(parcelId, context.agentId),
                ],
                planner: navigation.planner,
            };
        }

        return {
            result: "planned",
            actions: [
                ...navigation.actions,
                context.actionFactory.drop(context.agentId),
            ],
            planner: navigation.planner,
        };
    }

    private async buildSearchPlan(
        context: IntentionContext,
    ): Promise<PLAN_BUILD_STATUS> {
        const searchIntention = this.intentionGenerator.generate({
            id: context.agentId,
            position: context.agentPosition,
        }).find(
            (intention: Intention): boolean => intention instanceof SearchIntention,
        );
        if (!searchIntention) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }

        this.currentIntention = searchIntention;
        const searchActions = searchIntention.buildActions(context);
        if (searchActions.length > 0) {
            this.replacePlan(searchActions, searchIntention);
            return PLAN_BUILD_STATUS.PLANNED;
        }
        if (searchIntention.isSatisfied(context)) {
            this.replacePlan([], searchIntention);
            return PLAN_BUILD_STATUS.SATISFIED;
        }

        const pddlGoal = searchIntention.toPddlGoal(context);
        if (!pddlGoal) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }
        const navigationActions = await this.buildPddlNavigationActions(
            pddlGoal.finalTargetPosition,
            context,
        );
        if (navigationActions === undefined) {
            this.replacePlan([]);
            return PLAN_BUILD_STATUS.INFEASIBLE;
        }

        this.replacePlan(
            [
                ...navigationActions,
                ...searchIntention.buildPddlCompletionActions(context),
            ],
            searchIntention,
        );
        return PLAN_BUILD_STATUS.PLANNED;
    }

    /** Replaces executable actions together with the intention entitled to completion. */
    private replacePlan(actions: Action[], owner?: Intention): void {
        this.plan.newPlan(actions);
        this.planOwner = owner;
    }

    /** Notifies only the intention that created the successfully executed plan. */
    private completePlan(context: IntentionContext): void {
        const completedPlanOwner = this.planOwner;
        this.planOwner = undefined;
        completedPlanOwner?.onPlanCompleted(context);
    }

    private async buildNavigationActions(
        targetLocation: Position,
        context: IntentionContext,
    ): Promise<NavigationBuildResult | undefined> {
        const directActions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            targetLocation,
            context.crates,
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
        context: IntentionContext,
    ): Promise<Action[] | undefined> {
        this.pddlPlanner.resetPDDL();
        this.pddlPlanner.buildPDDLProblem(
            new GameMap(context.gameMap),
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

    private makeOptionLogEntries(
        evaluatedOptions: readonly ScoredIntention[],
        planFound: boolean,
    ): IntentionLogEntry[] {
        return evaluatedOptions.map(
            ({ intention, score, distance }: ScoredIntention): IntentionLogEntry => ({
                description: intention.describe(),
                score,
                distance,
                selected: planFound && intention === this.currentIntention,
            }),
        );
    }

    private makeBeliefLogSummary(): BeliefLogSummary {
        let freeParcels = 0;
        let carriedByAgent = 0;
        let carriedByOthers = 0;
        for (const parcel of this.beliefs.parcels.values()) {
            if (!parcel.carriedBy) {
                freeParcels += 1;
            } else if (parcel.carriedBy === this.id) {
                carriedByAgent += 1;
            } else {
                carriedByOthers += 1;
            }
        }
        return {
            knownParcels: this.beliefs.parcels.size,
            freeParcels,
            carriedByAgent,
            carriedByOthers,
            knownCrates: this.beliefs.crates.size,
            temporaryWalls: [...this.temporarilyBlockedCells.values()].map(
                (blockedCell: TemporaryBlockedCell): Position =>
                    blockedCell.position,
            ),
        };
    }

    private getIntentionContext(): IntentionContext {
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
            freeParcelsCount: this.beliefs.freeParcelsCount(),
            agentId: this.id,
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
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

    private gameMapWithTemporaryWalls(): string[][] {
        if (this.temporarilyBlockedCells.size === 0) {
            return this.beliefs.map;
        }
        const gameMap = this.beliefs.map.map(
            (column: string[]): string[] => [...column],
        );
        for (const blockedCell of this.temporarilyBlockedCells.values()) {
            const { position } = blockedCell;
            if (
                position.x >= 0
                && position.x < gameMap.length
                && position.y >= 0
                && position.y < gameMap[position.x].length
            ) {
                gameMap[position.x][position.y] = "0";
            }
        }
        return gameMap;
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

    /** Reward decay and expiration are already forecast by the evaluator. */
    private isPlanningRelevantBeliefChange(change: BeliefChange): boolean {
        return change.type !== BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED
            && change.type !== BELIEF_CHANGE_TYPE.PARCEL_DISAPPEARED;
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
