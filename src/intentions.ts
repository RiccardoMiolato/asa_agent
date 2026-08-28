import type { BasePathfinder } from "./astar.js";
import type { Parcel } from "./beliefs.js";
import type { Action, ActionFactory } from "./move.js";
import { PDDLGoal } from "./pddl/pddlPlanner.js";
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
    readonly freeParcelsCount: number;
    readonly agentId: string;
    readonly pathfinder: BasePathfinder;
    readonly actionFactory: ActionFactory;
}

export abstract class Intention {
    abstract score(context: IntentionContext): number;
    abstract buildActions(context: IntentionContext): Action[];
    abstract toPddlGoal(context: IntentionContext): PDDLGoal;
    abstract log(context: IntentionContext): void;

    shouldInterrupt(_context: IntentionContext): boolean {
        return false;
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

    toPddlGoal(context: IntentionContext): PDDLGoal {
        const carriedParcels: Parcel[] = Array.from(context.parcels.values()).filter(parcel => parcel.carriedBy === context.agentId);

        return {
            operationType: "search",
            agentId: context.agentId,
            parcelId: null,
            carriedParcels,
            finalTargetPosition: this.targetLocation!
        }
    }


    log(_context: IntentionContext): void {
        const target = this.targetLocation
            ? `(${this.targetLocation.x};${this.targetLocation.y})`
            : "undefined";
        console.log(`\x1b[33mSearchPacket at ${target}\x1b[0m`);
    }
}

/** Picks up a known parcel when its expected reward is positive. */
export class PickUpParcelIntention extends Intention {
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

        const deliveryTime = (
            (pickupDistance + shortestDeliveryDistance)
            * context.movementDuration
        ) / 1000;
        const candidateReward = Math.max(0, this.parcel.reward - deliveryTime);
        if (candidateReward === 0) {
            return -1;
        }

        let totalReward = candidateReward;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                totalReward += Math.max(0, parcel.reward - deliveryTime);
            }
        }
        return totalReward;
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
        );

        if (actions.length > 0 || context.agentPosition.isEqual(this.parcelPosition))
            actions.push(context.actionFactory.pickUp(this.parcel.id, context.agentId));

        return actions;
    }

    toPddlGoal(context: IntentionContext): PDDLGoal {
        const carriedParcels: Parcel[] = Array.from(context.parcels.values()).filter(parcel => parcel.carriedBy === context.agentId);

        return {
            operationType: "pickup",
            agentId: context.agentId,
            parcelId: this.parcel.id,
            carriedParcels,
            finalTargetPosition: this.parcelPosition
        }
    }

    log(context: IntentionContext): void {
        console.log(
            `\x1b[32mPickUp packet from (${this.parcelPosition.x};${this.parcelPosition.y}) - Score: ${this.score(context)}\x1b[0m`,
        );
    }
}

/** Delivers all parcels currently carried by the agent. */
export class DeliverParcelIntention extends Intention {
    private readonly knownFreeParcelIds: ReadonlySet<string>;

    constructor(
        readonly deliveryCell: Position,
        knownFreeParcelIds: ReadonlySet<string>,
    ) {
        super();
        this.knownFreeParcelIds = new Set(knownFreeParcelIds);
    }

    score(context: IntentionContext): number {
        const firstDeliveryDistance = context.pathfinder.pathLength(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
        );
        if (firstDeliveryDistance === undefined) {
            return -1;
        }

        const firstDeliveryTime = (
            firstDeliveryDistance * context.movementDuration
        ) / 1000;
        let carriedReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedReward += Math.max(0, parcel.reward - firstDeliveryTime);
            }
        }
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

            const finalDeliveryTime = (
                (
                    firstDeliveryDistance
                    + pickupDistance
                    + shortestDeliveryDistance
                ) * context.movementDuration
            ) / 1000;
            bestContinuationReward = Math.max(
                bestContinuationReward,
                Math.max(0, parcel.reward - finalDeliveryTime),
            );
        }

        return carriedReward + bestContinuationReward;
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
        );

        if (actions.length > 0 || context.agentPosition.isEqual(this.deliveryCell))
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

    toPddlGoal(context: IntentionContext): PDDLGoal {
        const carriedParcels: Parcel[] = Array.from(context.parcels.values()).filter(parcel => parcel.carriedBy === context.agentId);

        return {
            operationType: "deliver",
            agentId: context.agentId,
            parcelId: null,
            carriedParcels,
            finalTargetPosition: this.deliveryCell
        }
    }

    log(context: IntentionContext): void {
        console.log(
            `\x1b[36mDelivering packet at (${this.deliveryCell.x};${this.deliveryCell.y}) - Score: ${this.score(context)}\x1b[0m`,
        );
    }
}
