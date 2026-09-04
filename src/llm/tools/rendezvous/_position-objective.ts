/** Parity constraints supported for one grid coordinate. */
export enum GRID_COORDINATE_PARITY {
    ODD = "odd",
    EVEN = "even",
}

/** One coordinate can be exact, parity-constrained, or unrestricted. */
export type GridCoordinateObjective =
    | number
    | GRID_COORDINATE_PARITY
    | undefined;

/** JSON-safe representation used by the LLM and peer protocol. */
export interface GridPositionObjectiveDescription {
    readonly x: number | GRID_COORDINATE_PARITY | null;
    readonly y: number | GRID_COORDINATE_PARITY | null;
}

/** A map-position predicate whose axes are constrained independently. */
export class GridPositionObjective {
    constructor(
        readonly x: GridCoordinateObjective,
        readonly y: GridCoordinateObjective,
    ) {
        GridPositionObjective.validateCoordinate("x", x);
        GridPositionObjective.validateCoordinate("y", y);
    }

    /** Parses the strict JSON shape emitted by the mission-planning LLM. */
    static parse(value: unknown): GridPositionObjective | undefined {
        if (
            typeof value !== "object"
            || value === null
            || Array.isArray(value)
        ) {
            return undefined;
        }
        const record = value as Record<string, unknown>;
        if (
            !Object.prototype.hasOwnProperty.call(record, "x")
            || !Object.prototype.hasOwnProperty.call(record, "y")
            || !GridPositionObjective.isSerializedCoordinate(record["x"])
            || !GridPositionObjective.isSerializedCoordinate(record["y"])
        ) {
            return undefined;
        }
        return new GridPositionObjective(
            record["x"] === null ? undefined : record["x"],
            record["y"] === null ? undefined : record["y"],
        );
    }

    /** Whether a concrete coordinate satisfies both independent axes. */
    matches(x: number, y: number): boolean {
        return this.coordinateMatches(x, this.x)
            && this.coordinateMatches(y, this.y);
    }

    describe(): GridPositionObjectiveDescription {
        return {
            x: this.x ?? null,
            y: this.y ?? null,
        };
    }

    private coordinateMatches(
        value: number,
        objective: GridCoordinateObjective,
    ): boolean {
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

    private static validateCoordinate(
        axis: "x" | "y",
        value: GridCoordinateObjective,
    ): void {
        if (
            value !== undefined
            && value !== GRID_COORDINATE_PARITY.ODD
            && value !== GRID_COORDINATE_PARITY.EVEN
            && !Number.isInteger(value)
        ) {
            throw new RangeError(
                `Grid position objective ${axis} must be an integer, parity, or undefined`,
            );
        }
    }

    private static isSerializedCoordinate(
        value: unknown,
    ): value is number | GRID_COORDINATE_PARITY | null {
        return value === null
            || value === GRID_COORDINATE_PARITY.ODD
            || value === GRID_COORDINATE_PARITY.EVEN
            || typeof value === "number" && Number.isInteger(value);
    }
}
