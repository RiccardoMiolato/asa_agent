import type { PlanningContext } from "./planning.js";
import { Position } from "./utils/position.js";

/** Computes optimistic route lengths shared by search heuristics. */
export class OptimisticPathLengthEstimator {
    /**
     * Uses the executable route when one exists, otherwise retries without
     * crates to obtain a lower bound for crate-assisted planning.
     */
    static estimate(
        context: PlanningContext,
        startingPosition: Position,
        targetPosition: Position,
    ): number | undefined {
        const directDistance = context.pathfinder.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            context.crates,
        );
        if (directDistance !== undefined || context.crates.size === 0) {
            return directDistance;
        }

        return context.pathfinder.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            new Map<string, Position>(),
        );
    }
}
