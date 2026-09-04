import { Intention } from "../../../bdi/intentions.js";
/** Commits one protocol instruction independently of ordinary parcel options. */
export class ParcelHandoffIntention extends Intention {
    constructor(instruction) {
        super();
        this.instruction = instruction;
    }
    describe() {
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
//# sourceMappingURL=_objective.js.map