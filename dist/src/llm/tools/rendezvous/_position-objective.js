/** Parity constraints supported for one grid coordinate. */
export var GRID_COORDINATE_PARITY;
(function (GRID_COORDINATE_PARITY) {
    GRID_COORDINATE_PARITY["ODD"] = "odd";
    GRID_COORDINATE_PARITY["EVEN"] = "even";
})(GRID_COORDINATE_PARITY || (GRID_COORDINATE_PARITY = {}));
/** A map-position predicate whose axes are constrained independently. */
export class GridPositionObjective {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        GridPositionObjective.validateCoordinate("x", x);
        GridPositionObjective.validateCoordinate("y", y);
    }
    /** Parses the strict JSON shape emitted by the mission-planning LLM. */
    static parse(value) {
        if (typeof value !== "object"
            || value === null
            || Array.isArray(value)) {
            return undefined;
        }
        const record = value;
        if (!Object.prototype.hasOwnProperty.call(record, "x")
            || !Object.prototype.hasOwnProperty.call(record, "y")
            || !GridPositionObjective.isSerializedCoordinate(record["x"])
            || !GridPositionObjective.isSerializedCoordinate(record["y"])) {
            return undefined;
        }
        return new GridPositionObjective(record["x"] === null ? undefined : record["x"], record["y"] === null ? undefined : record["y"]);
    }
    /** Whether a concrete coordinate satisfies both independent axes. */
    matches(x, y) {
        return this.coordinateMatches(x, this.x)
            && this.coordinateMatches(y, this.y);
    }
    describe() {
        return {
            x: this.x ?? null,
            y: this.y ?? null,
        };
    }
    coordinateMatches(value, objective) {
        if (objective === undefined) {
            return true;
        }
        if (typeof objective === "number") {
            return value === objective;
        }
        const isEven = value % 2 === 0;
        return objective === GRID_COORDINATE_PARITY.EVEN
            ? isEven
            : !isEven;
    }
    static validateCoordinate(axis, value) {
        if (value !== undefined
            && value !== GRID_COORDINATE_PARITY.ODD
            && value !== GRID_COORDINATE_PARITY.EVEN
            && !Number.isInteger(value)) {
            throw new RangeError(`Grid position objective ${axis} must be an integer, parity, or undefined`);
        }
    }
    static isSerializedCoordinate(value) {
        return value === null
            || value === GRID_COORDINATE_PARITY.ODD
            || value === GRID_COORDINATE_PARITY.EVEN
            || typeof value === "number" && Number.isInteger(value);
    }
}
//# sourceMappingURL=_position-objective.js.map