import type { Beliefs } from "./beliefs.js";
import {
    DeliverParcelIntention,
    type Intention,
    PickUpParcelIntention,
    SearchIntention,
} from "./intentions.js";
import { Position } from "./position.js";

export interface AgentState {
    readonly id: string;
    readonly position: Position;
}

/** Generates the intentions available from the current agent and world state. */
export class IntentionGenerator {
    private readonly searchIntention: SearchIntention;

    constructor(private readonly beliefs: Beliefs) {
        this.searchIntention = new SearchIntention();
    }

    generate(agentState: AgentState): Intention[] {
        const intentions: Intention[] = [];
        const freeParcelIds = new Set<string>();
        let carriesParcel = false;

        for (const parcel of this.beliefs.parcels.values()) {
            if (!parcel.carriedBy) {
                freeParcelIds.add(parcel.id);
                intentions.push(
                    new PickUpParcelIntention(
                        parcel,
                        new Position(parcel.x, parcel.y),
                    ),
                );
                continue;
            }

            if (parcel.carriedBy === agentState.id) {
                carriesParcel = true;
            }
        }

        if (carriesParcel) {
            for (const deliveryCell of this.beliefs.delivering_cells) {
                intentions.push(
                    new DeliverParcelIntention(deliveryCell, freeParcelIds),
                );
            }
        }

        intentions.push(this.searchIntention);

        return intentions;
    }
}
