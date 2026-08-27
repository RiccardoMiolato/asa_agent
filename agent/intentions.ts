import agent from "./agent.js";
import { Position } from "./astar.js";
import beliefs, { Parcel } from "./beliefs.js";
import { getClosestDeliveringCell } from "./utils.js";

export enum IntentionType {
    SearchPacket,
    PickUpPacket,
    DeliverPacket,
}

export abstract class Intention {
    constructor(private readonly intentionType: IntentionType) { }

    getType(): IntentionType {
        return this.intentionType;
    }

    abstract score(): number;
    abstract log(): void;
}

/**
 * Search Intention
 * Used when I don't know what to do
 *
 * The idea is to navigate the map until I
 * find something usefull for my goals
 */
export class SearchIntention extends Intention {
    targetLocation: Position | undefined;

    constructor() {
        super(IntentionType.SearchPacket);
        this.targetLocation = undefined;
    }

    score(): number { return 0 };

    log() {
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
    parcel: Parcel;
    parcelPosition: Position;

    constructor(parcel: Parcel, parcelPosition: Position) {
        super(IntentionType.PickUpPacket);
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

    log() {
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
    deliveryCell: Position;

    constructor(deliveryCell: Position) {
        super(IntentionType.DeliverPacket);
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

    log() {
        console.log(`\x1b[36mDelivering packet at (${this.deliveryCell.x};${this.deliveryCell.y}) - Score: ${this.score()}\x1b[0m`);
    }
}