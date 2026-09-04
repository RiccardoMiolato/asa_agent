import { DeliverParcelIntention, PickUpParcelIntention, SearchIntention, } from "./intentions.js";
import { Position } from "./position.js";
/** Generates the intentions available from the current agent and world state. */
export class IntentionGenerator {
    constructor(beliefs) {
        this.beliefs = beliefs;
    }
    generate(agentState) {
        const intentions = [];
        const freeParcelIds = new Set();
        let carriesParcel = false;
        for (const parcel of this.beliefs.parcels.values()) {
            if (!parcel.carriedBy) {
                freeParcelIds.add(parcel.id);
                intentions.push(new PickUpParcelIntention(parcel, new Position(parcel.x, parcel.y)));
                continue;
            }
            if (parcel.carriedBy === agentState.id) {
                carriesParcel = true;
            }
        }
        if (carriesParcel) {
            for (const deliveryCell of this.beliefs.delivering_cells) {
                intentions.push(new DeliverParcelIntention(deliveryCell, freeParcelIds));
            }
        }
        if (intentions.length === 0) {
            intentions.push(new SearchIntention());
        }
        return intentions;
    }
}
//# sourceMappingURL=desires.js.map