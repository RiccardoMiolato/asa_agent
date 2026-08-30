import {
    type BaseAgentLogger,
    type BeliefLogSummary,
    type IntentionLogEntry,
} from "./_logging.js";
import type { BasePathfinder } from "./astar.js";
import type { Beliefs } from "./beliefs.js";
import type { IntentionGenerator } from "./desires.js";
import {
    Intention,
    SearchIntention,
    type IntentionContext,
    type IntentionDescription,
    type PickupClusterSnapshot,
} from "./intentions.js";
import { Action, MovementAction, type ActionFactory } from "./move.js";
import { ConservativeMovementGuard } from "./movement-safety.js";
import { Option, OptionEvaluator } from "./option_evaluator.js";
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
    private readonly optionEvaluator: OptionEvaluator;
    private readonly plan: Plan;
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
    ) {
        this.id = "";
        this.position = new Position(0, 0);
        this.score = undefined;
        this.intentions = [];
        this.isBeliefChanged = false;
        this.currentOptionsList = [];
        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
        this.movementGuard = new ConservativeMovementGuard(
            this.beliefs,
            this.logger,
        );
        this.temporarilyBlockedCells = new Map<string, TemporaryBlockedCell>();
        this.gridPositionWaiters = new Set<() => void>();
        this.hasAuthoritativePosition = false;
        this.deliberationCycle = 0;
        this.pddlPlanner = new PDDLPlanner(this.actionFactory);
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
        while (true) {
            if (!deliberateImmediately) {
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );
            }
            deliberateImmediately = false;

            await this.waitForGridPosition();

            this.deliberationCycle += 1;
            this.refreshTemporaryBlockedCells();
            this.beliefs.updateParcelRewards();
            const context = this.getIntentionContext();

            this.currentOptionsList = this.optionEvaluator.evaluate(context);

            // const evaluatedOptions = this.filterOptions(context);
            const planStatus = await this.buildPlan(context);

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
                    break;
                }

                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );

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
                    break;
                }
                this.plan.popAction();
                if (movementDestination) {
                    planMoved = true;
                }

                if(this.plan.isEmpty() && this.currentOptionsList.length > 0) {
                    await this.buildPlan(this.getIntentionContext());
                }
            }

            if (!planInterrupted && this.plan.isEmpty()) {
                this.currentIntention.onPlanCompleted(this.getIntentionContext());
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

        this.plan.newPlan([]);
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
        const bestOption = this.currentOptionsList.shift();

        if (!bestOption) {
            // No viable option found, fall back to search
            const searchActions = this.buildSearchActions(context);
            this.plan.newPlan(searchActions);
            return searchActions.length > 0 ? PLAN_BUILD_STATUS.PLANNED : PLAN_BUILD_STATUS.INFEASIBLE;
        }

        const actions = this.buildActionsFromOption(bestOption, context);

        if (actions.length > 0) {
            this.plan.newPlan(actions);
            return PLAN_BUILD_STATUS.PLANNED;
        }

        return PLAN_BUILD_STATUS.INFEASIBLE;
    }

    private buildActionsFromOption(option: Option, context: IntentionContext): Action[] {
        const targetCell = option.getTargetCell();
        const actions: Action[] = [];

        // Pathfind to option target
        const path = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            targetCell,
            context.crates
        );
        actions.push(...path);

        // Add pick/drop action
        if (option.getType() === "pick") {
            actions.push(context.actionFactory.pickUp(option.getParcelId()!, context.agentId));
        } else {
            actions.push(context.actionFactory.drop(context.agentId));
        }

        return actions;
    }

    private buildSearchActions(context: IntentionContext): Action[] {
        if (context.pickupCells.length === 0)
            return [];

        const index = Math.floor(Math.random() * context.pickupCells.length);
        const targetLocation = context.pickupCells[index];

        return context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            targetLocation,
            context.crates
        );
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
}
