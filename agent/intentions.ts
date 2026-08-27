import agent from "./agent.js";
import { Astar, Position } from "./astar.js";
import beliefs, { Parcel } from "./beliefs.js";
import { Action, Drop, PickUp } from "./move.js";
import { getClosestDeliveringCell } from "./utils.js";

export interface IntentionContext {
    // readonly bc we don't want a method to modify context properties
    readonly gameMap: string[][];
    readonly agentPosition: Position;
    readonly crates: Map<string, Position>;
    readonly pickupCells: Position[];
    readonly freeParcelsCount: number;
    readonly agentId: string;
}

export abstract class Intention {
    abstract score(): number;
    abstract buildActions(context: IntentionContext): Action[];
    abstract log(): void;

    shouldInterrupt(_context: IntentionContext): boolean {
        return false;
    }
}

/**
 * Search Intention
 * Used when I don't know what to do
 *
 * The idea is to navigate the map until I
 * find something usefull for my goals
 */
export class SearchIntention extends Intention {
    private targetLocation: Position | undefined;

    constructor() {
        super();
        this.targetLocation = undefined;
    }

    score(): number {
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
        return Astar(
            context.gameMap,
            context.agentPosition,
            targetLocation,
            context.crates,
            undefined,
        );
    }

    shouldInterrupt(context: IntentionContext): boolean {
        return context.freeParcelsCount > 0;
    }

    log(): void {
        console.log(`\x1b[33mSearchPacket ar ${this.targetLocation ? `(${this.targetLocation.x};${this.targetLocation.y})` : `undefined`}\x1b[0m`);
    }
}

/**
 * PickUp Parcel
 * If I know where to find a parcel
 * the idea is to go to its position
 * and pick it up
 */
export class PickUpParcelIntention extends Intention {
    readonly parcel: Parcel;
    readonly parcelPosition: Position;

    constructor(parcel: Parcel, parcelPosition: Position) {
        super();
        this.parcelPosition = parcelPosition;
        this.parcel = parcel;
    }

    /**
     * Idea: I compute how much I gain by picking up and delivering a certain parcel
     */
    score(): number {
        const parcelDistance = this.parcelPosition.distance_Astar(agent.position);

        const closestDeliveryFromParcel = getClosestDeliveringCell(this.parcelPosition, beliefs.delivering_cells, beliefs.crates.values().next().value);
        if (closestDeliveryFromParcel !== undefined) {
            const deliveryDistance = this.parcelPosition.distance_Astar(closestDeliveryFromParcel);

            const timeToDeliver = ((parcelDistance + deliveryDistance) * beliefs.movement_duration) / 1000.0;
            if (this.parcel.reward > timeToDeliver) {
                let reward = this.parcel.reward - timeToDeliver;

                beliefs.parcels.forEach((parcel: Parcel) => {
                    if (parcel.carriedBy === agent.id) {
                        reward += Math.max(0, parcel.reward - timeToDeliver);
                    }
                });

                return reward;
            }
        }

        return -1;
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = Astar(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
            undefined,
        );

        actions.push(new PickUp(this.parcel.id, context.agentId));
        return actions;
    }

    log(): void {
        console.log(`\x1b[32mPickUp packet from (${this.parcelPosition.x};${this.parcelPosition.y}) - Score: ${this.score()}\x1b[0m`);
    }
}

/**
 * Deliver Parcel
 * If I carry one or more parcel, then to
 * score points it is important to deliver it
 * to the specific delivery points
 */
export class DeliverParcelIntention extends Intention {
    readonly deliveryCell: Position;

    constructor(deliveryCell: Position) {
        super();
        this.deliveryCell = deliveryCell;
    }

    /**
     * Idea: calculate how much points I get by delivering current parcels
     */
    score(): number {
        const closestDeliveryFromParcel = getClosestDeliveringCell(agent.position, beliefs.delivering_cells, beliefs.crates.values().next().value);

        if (closestDeliveryFromParcel !== undefined) {
            const timeToDeliver = (agent.position.distance_Astar(closestDeliveryFromParcel) * beliefs.movement_duration) / 1000.0;

            let reward = 0;

            beliefs.parcels.forEach((parcel: Parcel) => {
                if (parcel.carriedBy === agent.id) {
                    reward += Math.max(0, parcel.reward - timeToDeliver);
                }
            });

            return reward;
        }

        return -1;
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = Astar(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
            undefined,
        );

        actions.push(new Drop());
        return actions;
    }

    log(): void {
        console.log(`\x1b[36mDelivering packet at (${this.deliveryCell.x};${this.deliveryCell.y}) - Score: ${this.score()}\x1b[0m`);
    }
}
