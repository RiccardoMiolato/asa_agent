import { Intention } from "../../../bdi/intentions.js";
import type { PlanningObjectiveDescription } from "../../../planning.js";
import type { ParcelHandoffInstruction } from "./_coordinator.js";

/** Commits one protocol instruction independently of ordinary parcel options. */
export class ParcelHandoffIntention extends Intention {
    constructor(readonly instruction: ParcelHandoffInstruction) {
        super();
    }

    describe(): PlanningObjectiveDescription {
        return {
            type: "parcel-handoff",
            phase: this.instruction.type,
            parcelId: this.instruction.parcelId,
            target: this.instruction.type === "wait"
                ? undefined
                : this.instruction.target,
        };
    }
}
