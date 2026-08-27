import type { IOCrate } from "./IOCrate.js";
import type { IOParcel } from "./IOParcel.js";

/** Grid coordinate included in the authoritative sensing coverage. */
export interface IOSensedPosition {
    readonly x: number;
    readonly y: number;
}

export interface IOSensing {
    positions: IOSensedPosition[];
    parcels: IOParcel[];
    crates: IOCrate[];
}
