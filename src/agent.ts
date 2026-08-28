import type { BasePathfinder } from "./astar.js";
import {
    type BaseAgentLogger,
    type BeliefLogSummary,
    type IntentionLogEntry,
} from "./_logging.js";
import type { Beliefs } from "./beliefs.js";
import type { IntentionGenerator } from "./desires.js";
import {
    SearchIntention,
    type Intention,
    type IntentionContext,
    type IntentionDescription,
    type PickupClusterSnapshot,
} from "./intentions.js";
import type { ActionFactory } from "./move.js";
import { MovementAction } from "./move.js";
import { ConservativeMovementGuard } from "./movement-safety.js";
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

/** Coordinates intention generation, selection, planning, and execution. */
export class Agent {
    id: string;
    readonly position: Position;

    private score: number | undefined;
    private intentions: Intention[];
    private currentIntention: Intention;
    private readonly plan: Plan;
    private readonly movementGuard: ConservativeMovementGuard;
    private readonly temporarilyBlockedCells: Map<string, TemporaryBlockedCell>;
    private deliberationCycle: number;

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
        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
        this.movementGuard = new ConservativeMovementGuard(
            this.beliefs,
            this.logger,
        );
        this.temporarilyBlockedCells = new Map<string, TemporaryBlockedCell>();
        this.deliberationCycle = 0;
    }

    updatePosition(x: number, y: number): void {
        this.position.x = x;
        this.position.y = y;
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
    async agent_loop(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));

        let deliberateImmediately = false;
        while (true) {
            if (!deliberateImmediately) {
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );
            }
            deliberateImmediately = false;

            this.deliberationCycle += 1;
            this.refreshTemporaryBlockedCells();
            this.beliefs.updateParcelRewards();
            const options = this.intentionGenerator.generate({
                id: this.id,
                position: this.position,
            });
            this.addIntentions(options);
            this.pathfinder.clearPathLengthCache();

            const context = this.getIntentionContext();
            const evaluatedOptions = this.filterOptions(context);
            this.buildPlan(context);
            this.logger.logDeliberation({
                cycle: this.deliberationCycle,
                agentId: this.id,
                agentScore: this.score,
                position: this.position,
                beliefs: this.makeBeliefLogSummary(),
                options: this.makeOptionLogEntries(evaluatedOptions),
                plannedActions: this.plan.size(),
            });

            let planInterrupted = false;
            let planMoved = false;
            while (!this.plan.isEmpty()) {
                if (this.currentIntention.shouldInterrupt(this.getIntentionContext())) {
                    planInterrupted = true;
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
                    if (
                        this.currentIntention.shouldInterrupt(
                            this.getIntentionContext(),
                        )
                    ) {
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

    /** Scores each option once and selects the highest-scoring intention. */
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
        return scoredIntentions;
    }

    buildPlan(context: IntentionContext = this.getIntentionContext()): void {
        const actions = this.currentIntention.buildActions(context);
        this.plan.newPlan(actions);
    }

    private makeOptionLogEntries(
        evaluatedOptions: readonly ScoredIntention[],
    ): IntentionLogEntry[] {
        return evaluatedOptions.map(
            ({ intention, score, distance }: ScoredIntention): IntentionLogEntry => ({
                description: intention.describe(),
                score,
                distance,
                selected: intention === this.currentIntention,
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
            agentPosition: this.position,
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
}
