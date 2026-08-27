import type { IOCrate } from "./IOCrate.js";
import type { IOParcel } from "./IOParcel.js";

export interface IOSensing {
    parcels: IOParcel[];
    crates: IOCrate[];
}
