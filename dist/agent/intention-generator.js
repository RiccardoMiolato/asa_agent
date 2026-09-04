import { DeliverParcelIntention, PickUpParcelIntention, SearchIntention, } from "./intentions.js";
import { Position } from "./position.js";
import { getClosestDeliveringCell } from "./utils.js";
/** Generates the intentions available from the current agent and world state. */
export class IntentionGenerator {
    constructor(beliefs) {
        this.beliefs = beliefs;
    }
    generate(agentState) {
        const intentions = [];
        let hasDeliveryIntention = false;
        for (const parcel of this.beliefs.parcels.values()) {
            if (!parcel.carriedBy) {
                intentions.push(new PickUpParcelIntention(parcel, new Position(parcel.x, parcel.y)));
                continue;
            }
            if (parcel.carriedBy !== agentState.id || hasDeliveryIntention) {
                continue;
            }
            const closestDelivery = getClosestDeliveringCell(agentState.position, this.beliefs.delivering_cells, this.beliefs.crates.values().next().value);
            if (closestDelivery) {
                intentions.push(new DeliverParcelIntention(closestDelivery));
                hasDeliveryIntention = true;
            }
        }
        if (intentions.length === 0) {
            intentions.push(new SearchIntention());
        }
        return intentions;
    }
}
//# sourceMappingURL=intention-generator.js.map