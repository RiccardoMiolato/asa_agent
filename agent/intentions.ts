import agent from "./agent.js";
import { Position } from "./astar.js";
import beliefs, { Parcel } from "./beliefs.js";
import { getClosestDeliveringCell } from "./utils.js";

export enum IntentionType {
    Null,
    SearchPacket,
    PickUpPacket,
    DeliverPacket,
};

/**
 * Default export class for Intentions
 */
export class Intention {
    intentionType: IntentionType;

    constructor(intentionType: IntentionType = IntentionType.Null) {
        this.intentionType = intentionType;
    }

    getType(): IntentionType {
        return this.intentionType;
    }

    score(): number {
        throw new Error("Method not implemented.");
    }

    log() {
        console.log("Null intention");
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
    constructor() {
        super(IntentionType.SearchPacket);
    }

    score(): number { return 0 };

    log() {
        console.log("SearchPacket")
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
        const parcelDistance = this.parcelPosition.distanceTo(agent.position);

        const closestDeliveryFromParcel = getClosestDeliveringCell(this.parcelPosition, beliefs.delivering_cells, beliefs.crates.values().next().value);
        if (closestDeliveryFromParcel !== undefined){
            const deliveryDistance = this.parcelPosition.distanceTo(closestDeliveryFromParcel);

            const timeToDeliver = ((parcelDistance + deliveryDistance) * beliefs.movement_duration) / 1000.0;
            if (this.parcel.reward > timeToDeliver)
                return this.parcel.reward - timeToDeliver;
        }

        return -1;
    }

    log() {
        console.log(`PickUp packet from (${this.parcelPosition.x};${this.parcelPosition.y})`);
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

        if (closestDeliveryFromParcel !== undefined){
            const timeToDeliver = agent.position.distanceTo(closestDeliveryFromParcel) * beliefs.movement_duration;

            let reward = 0;

            agent.getCarryingParcels().forEach(parcel => reward += Math.max(0, parcel.reward - timeToDeliver))

            return reward;
        }

        return -1;
    }

    log() {
        console.log(`Delivering packet at (${this.deliveryCell.x};${this.deliveryCell.y})`);
    }
}