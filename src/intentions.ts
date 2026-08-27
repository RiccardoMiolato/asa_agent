import type { BasePathfinder } from "./astar.js";
import type { Parcel } from "./beliefs.js";
import type { Action, ActionFactory } from "./move.js";
import { Position } from "./position.js";

/** Current world state and services available to an intention. */
export interface IntentionContext {
    readonly gameMap: string[][];
    readonly agentPosition: Position;
    readonly crates: ReadonlyMap<string, Position>;
    readonly pickupCells: readonly Position[];
    readonly deliveringCells: readonly Position[];
    readonly parcels: ReadonlyMap<string, Parcel>;
    readonly movementDuration: number;
    readonly frameDuration: number;
    readonly millisecondsUntilNextRewardDecay: number | undefined;
    readonly freeParcelsCount: number;
    readonly agentId: string;
    readonly pathfinder: BasePathfinder;
    readonly actionFactory: ActionFactory;
}

/** Structured description used to log an intention without recomputing its score. */
export type IntentionDescription =
    | {
        readonly type: "search";
        readonly target: Position | undefined;
    }
    | {
        readonly type: "pick-up";
        readonly parcelId: string;
        readonly target: Position;
        readonly reward: number;
    }
    | {
        readonly type: "deliver";
        readonly target: Position;
        readonly parcelCount: number;
        readonly estimatedGain: number;
    };

export abstract class Intention {
    abstract score(context: IntentionContext): number;
    abstract buildActions(context: IntentionContext): Action[];
    abstract describe(): IntentionDescription;

    /** Manhattan distance used to prefer the closest option when scores are equal. */
    selectionDistance(_context: IntentionContext): number | undefined {
        return undefined;
    }

    shouldInterrupt(_context: IntentionContext): boolean {
        return false;
    }
}

/** Base for intentions whose score depends on reward decay during execution. */
export abstract class RewardIntention extends Intention {
    /**
     * Predicts the integer reward remaining after the real action-loop delays.
     * Each move incurs a client wait, server movement, and frame synchronization.
     */
    protected estimateReward(
        reward: number,
        movementCount: number,
        extraWaitCount: number,
        movementDuration: number,
        frameDuration: number,
        millisecondsUntilNextDecay: number | undefined,
    ): number {
        const executionMilliseconds = (
            movementCount * 2 + extraWaitCount
        ) * movementDuration + movementCount * frameDuration;
        const decayTicks = this.estimateDecayTicks(
            executionMilliseconds,
            millisecondsUntilNextDecay,
        );
        return Math.max(0, reward - decayTicks);
    }

    private estimateDecayTicks(
        executionMilliseconds: number,
        millisecondsUntilNextDecay: number | undefined,
    ): number {
        if (millisecondsUntilNextDecay === undefined) {
            return Math.round(executionMilliseconds / 1_000);
        }
        if (executionMilliseconds < millisecondsUntilNextDecay) {
            return 0;
        }
        return 1 + Math.floor(
            (executionMilliseconds - millisecondsUntilNextDecay) / 1_000,
        );
    }
}

/** Explores parcel pickup cells when no more valuable intention exists. */
export class SearchIntention extends Intention {
    private targetLocation: Position | undefined;

    score(_context: IntentionContext): number {
        return 0;
    }

    buildActions(context: IntentionContext): Action[] {
        const index = Math.floor(Math.random() * context.pickupCells.length);
        const targetLocation = context.pickupCells[index];

        if (!targetLocation) {
            this.targetLocation = undefined;
            return [];
        }

        this.targetLocation = targetLocation;
        return context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            targetLocation,
            context.crates,
        );
    }

    shouldInterrupt(context: IntentionContext): boolean {
        return context.freeParcelsCount > 0;
    }

    describe(): IntentionDescription {
        return {
            type: "search",
            target: this.targetLocation,
        };
    }
}

/** Picks up a known parcel when its expected reward is positive. */
export class PickUpParcelIntention extends RewardIntention {
    constructor(
        readonly parcel: Parcel,
        readonly parcelPosition: Position,
    ) {
        super();
    }

    score(context: IntentionContext): number {
        const pickupDistance = context.pathfinder.pathLength(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
        );
        if (pickupDistance === undefined) {
            return -1;
        }

        let shortestDeliveryDistance: number | undefined;
        for (const deliveryCell of context.deliveringCells) {
            const deliveryDistance = context.pathfinder.pathLength(
                context.gameMap,
                this.parcelPosition,
                deliveryCell,
                context.crates,
            );
            if (deliveryDistance === undefined) {
                continue;
            }
            if (
                shortestDeliveryDistance === undefined
                || deliveryDistance < shortestDeliveryDistance
            ) {
                shortestDeliveryDistance = deliveryDistance;
            }
        }

        if (shortestDeliveryDistance === undefined) {
            return -1;
        }

        const totalMovementCount = pickupDistance + shortestDeliveryDistance;
        const candidateReward = this.estimateReward(
            this.parcel.reward,
            totalMovementCount,
            3,
            context.movementDuration,
            context.frameDuration,
            context.millisecondsUntilNextRewardDecay,
        );
        if (candidateReward === 0) {
            return -1;
        }

        let totalReward = candidateReward;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                totalReward += this.estimateReward(
                    parcel.reward,
                    totalMovementCount,
                    3,
                    context.movementDuration,
                    context.frameDuration,
                    context.millisecondsUntilNextRewardDecay,
                );
            }
        }
        return totalReward;
    }

    selectionDistance(context: IntentionContext): number | undefined {
        return context.agentPosition.distanceTo(this.parcelPosition);
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
        );
        actions.push(context.actionFactory.pickUp(this.parcel.id, context.agentId));
        return actions;
    }

    describe(): IntentionDescription {
        return {
            type: "pick-up",
            parcelId: this.parcel.id,
            target: this.parcelPosition,
            reward: this.parcel.reward,
        };
    }
}

/** Delivers all parcels currently carried by the agent. */
export class DeliverParcelIntention extends RewardIntention {
    private readonly knownFreeParcelIds: ReadonlySet<string>;
    private carriedParcelCount: number;
    private estimatedDeliveryGain: number;

    constructor(
        readonly deliveryCell: Position,
        knownFreeParcelIds: ReadonlySet<string>,
    ) {
        super();
        this.knownFreeParcelIds = new Set(knownFreeParcelIds);
        this.carriedParcelCount = 0;
        this.estimatedDeliveryGain = 0;
    }

    score(context: IntentionContext): number {
        this.carriedParcelCount = 0;
        this.estimatedDeliveryGain = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                this.carriedParcelCount += 1;
            }
        }

        const firstDeliveryDistance = context.pathfinder.pathLength(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
        );
        if (firstDeliveryDistance === undefined) {
            return -1;
        }

        let carriedReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedReward += this.estimateReward(
                    parcel.reward,
                    firstDeliveryDistance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                    context.millisecondsUntilNextRewardDecay,
                );
            }
        }
        this.estimatedDeliveryGain = carriedReward;
        if (carriedReward === 0) {
            return -1;
        }

        let bestContinuationReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }

            const parcelPosition = new Position(parcel.x, parcel.y);
            const pickupDistance = context.pathfinder.pathLength(
                context.gameMap,
                this.deliveryCell,
                parcelPosition,
                context.crates,
            );
            if (pickupDistance === undefined) {
                continue;
            }

            let shortestDeliveryDistance: number | undefined;
            for (const finalDeliveryCell of context.deliveringCells) {
                const deliveryDistance = context.pathfinder.pathLength(
                    context.gameMap,
                    parcelPosition,
                    finalDeliveryCell,
                    context.crates,
                );
                if (deliveryDistance === undefined) {
                    continue;
                }
                if (
                    shortestDeliveryDistance === undefined
                    || deliveryDistance < shortestDeliveryDistance
                ) {
                    shortestDeliveryDistance = deliveryDistance;
                }
            }

            if (shortestDeliveryDistance === undefined) {
                continue;
            }

            const totalMovementCount = firstDeliveryDistance
                + pickupDistance
                + shortestDeliveryDistance;
            bestContinuationReward = Math.max(
                bestContinuationReward,
                this.estimateReward(
                    parcel.reward,
                    totalMovementCount,
                    5,
                    context.movementDuration,
                    context.frameDuration,
                    context.millisecondsUntilNextRewardDecay,
                ),
            );
        }

        return carriedReward + bestContinuationReward;
    }

    selectionDistance(context: IntentionContext): number | undefined {
        return context.agentPosition.distanceTo(this.deliveryCell);
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
        );
        actions.push(context.actionFactory.drop(context.agentId));
        return actions;
    }

    shouldInterrupt(context: IntentionContext): boolean {
        let freeParcelCount = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            freeParcelCount += 1;
            if (!this.knownFreeParcelIds.has(parcel.id)) {
                return true;
            }
        }
        return freeParcelCount !== this.knownFreeParcelIds.size;
    }

    describe(): IntentionDescription {
        return {
            type: "deliver",
            target: this.deliveryCell,
            parcelCount: this.carriedParcelCount,
            estimatedGain: this.estimatedDeliveryGain,
        };
    }
}
