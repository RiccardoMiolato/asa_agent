import type { IOCrate } from "./IOCrate.js";
import type { IOParcel } from "./IOParcel.js";
import type { IOAgent } from "./IOAgent.js";

/** Grid coordinate included in the authoritative sensing coverage. */
export interface IOSensedPosition {
    readonly x: number;
    readonly y: number;
}

/** Another agent whose position is present in a sensing snapshot. */
export interface IOSensedAgent extends IOAgent {
    readonly x: number;
    readonly y: number;
}

export interface IOSensing {
    positions: IOSensedPosition[];
    agents: IOSensedAgent[];
    parcels: IOParcel[];
    crates: IOCrate[];
}
