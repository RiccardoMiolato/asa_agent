/** Computes optimistic route lengths shared by search heuristics. */
export class OptimisticPathLengthEstimator {
    /**
     * Uses the executable route when one exists, otherwise retries without
     * crates to obtain a lower bound for crate-assisted planning.
     */
    static estimate(context, startingPosition, targetPosition) {
        const directDistance = context.pathfinder.pathLength(context.gameMap, startingPosition, targetPosition, context.crates);
        if (directDistance !== undefined || context.crates.size === 0) {
            return directDistance;
        }
        return context.pathfinder.pathLength(context.gameMap, startingPosition, targetPosition, new Map());
    }
}
//# sourceMappingURL=_path-estimation.js.map