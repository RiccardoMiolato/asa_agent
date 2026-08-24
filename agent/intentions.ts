import { Position } from "./astar.js";
import { Parcel } from "./beliefs.js";

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
}

/**
 * PickUp Parcel
 * If I know where to find a parcel
 * the idea is to go to its position
 * and pick it up
 */
export class PickUpParcelIntention extends Intention {
    parcel: Parcel; // TODO: check if both are usefull or only one can work
    parcelPosition: Position;

    constructor(parcel: Parcel, parcelPosition: Position) {
        super(IntentionType.PickUpPacket);
        this.parcelPosition = parcelPosition;
        this.parcel = parcel;
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
}