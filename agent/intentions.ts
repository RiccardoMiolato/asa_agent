import type { BasePathfinder } from "./astar.js";
import type { Parcel } from "./beliefs.js";
import type { Action, ActionFactory } from "./move.js";
import type { Position } from "./position.js";
import { getClosestDeliveringCell } from "./utils.js";

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
        const parcelDistance = context.pathfinder.pathLength(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
        );

        const closestDelivery = getClosestDeliveringCell(
            this.parcelPosition,
            context.deliveringCells,
            context.crates.values().next().value,
        );
        if (!closestDelivery) {
            return -1;
        }

        const deliveryDistance = context.pathfinder.pathLength(
            context.gameMap,
            this.parcelPosition,
            closestDelivery,
            context.crates,
        );
        const timeToDeliver =
            ((parcelDistance + deliveryDistance) * context.movementDuration) / 1000;

        if (this.parcel.reward <= timeToDeliver) {
            return -1;
        }

        let reward = this.parcel.reward - timeToDeliver;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                reward += Math.max(0, parcel.reward - timeToDeliver);
            }
        }

        return reward;
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

    log(context: IntentionContext): void {
        console.log(
            `\x1b[32mPickUp packet from (${this.parcelPosition.x};${this.parcelPosition.y}) - Score: ${this.score(context)}\x1b[0m`,
        );
    }
}

/** Delivers all parcels currently carried by the agent. */
export class DeliverParcelIntention extends Intention {
    constructor(readonly deliveryCell: Position) {
        super();
    }

    score(context: IntentionContext): number {
        const closestDelivery = getClosestDeliveringCell(
            context.agentPosition,
            context.deliveringCells,
            context.crates.values().next().value,
        );
        if (!closestDelivery) {
            return -1;
        }

        const deliveryDistance = context.pathfinder.pathLength(
            context.gameMap,
            context.agentPosition,
            closestDelivery,
            context.crates,
        );
        const timeToDeliver = (deliveryDistance * context.movementDuration) / 1000;

        let reward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                reward += Math.max(0, parcel.reward - timeToDeliver);
            }
        }

        return reward;
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

    log(context: IntentionContext): void {
        console.log(
            `\x1b[36mDelivering packet at (${this.deliveryCell.x};${this.deliveryCell.y}) - Score: ${this.score(context)}\x1b[0m`,
        );
    }
}
