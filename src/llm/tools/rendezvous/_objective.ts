import { Position } from "../../../utils/position.js";

/** Validated parameters of a two-agent neighborhood rendezvous. */
export class RendezvousObjective {
    readonly center: Position;

    constructor(
        x: number,
        y: number,
        readonly maximumDistance: number,
        readonly reward: number,
    ) {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new RangeError("Rendezvous coordinates must be integers");
        }
        if (!Number.isInteger(maximumDistance) || maximumDistance < 0) {
            throw new RangeError(
                "Rendezvous maximum distance must be a non-negative integer",
            );
        }
        if (!Number.isFinite(reward) || reward <= 0) {
            throw new RangeError("Rendezvous reward must be finite and positive");
        }

        this.center = new Position(x, y);
    }
}
