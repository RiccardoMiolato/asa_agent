import { Heap } from "heap-js";
import { CellScoreEffectEvaluator, } from "./_cell-score-effects.js";
import { Position } from "./position.js";
/** Contract implemented by pathfinding algorithms. */
export class BasePathfinder {
    constructor() {
        this.pathLengthCache = new Map();
        this.pathLengthSymmetryCache = new Map();
    }
    /**
     * Returns both executable actions and visited positions.
     *
     * Implementations can override this to expose intermediate positions. The fallback keeps
     * third-party pathfinders compatible while still exposing the destination for coverage.
     */
    findMovementPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects = []) {
        const actions = this.findPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects);
        if (actions.length === 0 && !startingPosition.isEqual(targetPosition)) {
            return {
                actions,
                positions: [],
                movementSteps: 0,
                routingCost: Infinity,
                cellScore: 0,
                triggeredCellEffectIds: [],
            };
        }
        if (startingPosition.isEqual(targetPosition)) {
            return {
                actions,
                positions: [startingPosition],
                movementSteps: 0,
                routingCost: 0,
                cellScore: 0,
                triggeredCellEffectIds: [],
            };
        }
        const triggeredEffects = CellScoreEffectEvaluator.triggeredAt(targetPosition, cellScoreEffects, new Set());
        const cellScore = CellScoreEffectEvaluator.totalScore(triggeredEffects);
        return {
            actions,
            positions: [startingPosition, targetPosition],
            movementSteps: actions.length,
            routingCost: actions.length - cellScore,
            cellScore,
            triggeredCellEffectIds: triggeredEffects.map((effect) => effect.id),
        };
    }
    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(gameMap, startingPosition, targetPosition, crates, cellScoreEffects = []) {
        const cacheKey = this.pathLengthCacheKey(gameMap, startingPosition, targetPosition, crates, cellScoreEffects);
        if (this.pathLengthCache.has(cacheKey)) {
            return this.pathLengthCache.get(cacheKey);
        }
        const path = this.findMovementPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects);
        const pathLength = path.positions.length === 0
            ? undefined
            : path.movementSteps;
        this.pathLengthCache.set(cacheKey, pathLength);
        return pathLength;
    }
    /** Clears distances cached for the previous world-state deliberation. */
    clearPathLengthCache() {
        this.pathLengthCache.clear();
        this.pathLengthSymmetryCache.clear();
    }
    pathLengthCacheKey(gameMap, startingPosition, targetPosition, crates, cellScoreEffects) {
        const startingKey = `${startingPosition.x},${startingPosition.y}`;
        const targetKey = `${targetPosition.x},${targetPosition.y}`;
        // Entering the target can trigger an effect while starting there does not,
        // so mission-aware routes cannot share their reverse cache entry.
        const symmetricPath = cellScoreEffects.length === 0
            && this.pathLengthsAreSymmetric(gameMap);
        const [firstPosition, secondPosition] = symmetricPath
            && targetKey < startingKey
            ? [targetKey, startingKey]
            : [startingKey, targetKey];
        const cratePositions = [...crates.values()]
            .map((crate) => `${crate.x},${crate.y}`)
            .sort()
            .join("|");
        const mapSignature = gameMap.signature();
        const effectsSignature = CellScoreEffectEvaluator.signature(cellScoreEffects);
        return `${mapSignature}:${firstPosition}:${secondPosition}:${cratePositions}:${effectsSignature}`;
    }
    pathLengthsAreSymmetric(gameMap) {
        const cachedSymmetry = this.pathLengthSymmetryCache.get(gameMap);
        if (cachedSymmetry !== undefined) {
            return cachedSymmetry;
        }
        const pathLengthsAreSymmetric = this.hasSymmetricPathLengths(gameMap);
        this.pathLengthSymmetryCache.set(gameMap, pathLengthsAreSymmetric);
        return pathLengthsAreSymmetric;
    }
    /** Reports whether forward and reverse path lengths are interchangeable. */
    hasSymmetricPathLengths(_gameMap) {
        return false;
    }
}
/** A* pathfinder for the grid-based game map. */
export class AStarPathfinder extends BasePathfinder {
    constructor(actionFactory) {
        super();
        this.actionFactory = actionFactory;
    }
    findPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects = []) {
        return this.findMovementPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects).actions;
    }
    findMovementPath(gameMap, startingPosition, targetPosition, crates, cellScoreEffects = []) {
        if (!startingPosition.isGridAligned()) {
            return this.unreachablePath();
        }
        const cameFrom = new Map();
        const states = new Map();
        const routingCosts = new Map();
        const movementSteps = new Map();
        const openSet = new Heap((first, second) => first.priority - second.priority);
        const initialState = {
            position: startingPosition,
            triggeredEffectIds: new Set(),
        };
        const initialKey = this.searchStateKey(initialState);
        states.set(initialKey, initialState);
        routingCosts.set(initialKey, 0);
        movementSteps.set(initialKey, 0);
        openSet.add({
            stateKey: initialKey,
            priority: this.optimisticPriority(initialState, targetPosition, cellScoreEffects, 0),
            routingCost: 0,
            movementSteps: 0,
        });
        let bestTargetKey;
        while (openSet.size() > 0) {
            if (bestTargetKey !== undefined
                && openSet.peek().priority
                    > routingCosts.get(bestTargetKey)) {
                break;
            }
            const queueEntry = openSet.pop();
            if (!queueEntry) {
                continue;
            }
            if (routingCosts.get(queueEntry.stateKey)
                !== queueEntry.routingCost
                || movementSteps.get(queueEntry.stateKey)
                    !== queueEntry.movementSteps) {
                continue;
            }
            const current = states.get(queueEntry.stateKey);
            if (!current) {
                continue;
            }
            if (current.position.isEqual(targetPosition)) {
                if (bestTargetKey === undefined
                    || this.isBetterRoute(queueEntry.routingCost, queueEntry.movementSteps, routingCosts.get(bestTargetKey), movementSteps.get(bestTargetKey))) {
                    bestTargetKey = queueEntry.stateKey;
                }
                // Reaching an objective completes the route; do not leave and re-enter it.
                continue;
            }
            const neighbors = gameMap.getNeighborsOf(current.position);
            for (const { coord: neighbor, direction } of neighbors) {
                if (!this.isValidNeighbor(neighbor, gameMap, direction, crates)) {
                    continue;
                }
                const newlyTriggeredEffects = CellScoreEffectEvaluator.triggeredAt(neighbor, cellScoreEffects, current.triggeredEffectIds);
                const nextTriggeredEffectIds = new Set(current.triggeredEffectIds);
                for (const effect of newlyTriggeredEffects) {
                    nextTriggeredEffectIds.add(effect.id);
                }
                const nextState = {
                    position: neighbor,
                    triggeredEffectIds: nextTriggeredEffectIds,
                };
                const nextStateKey = this.searchStateKey(nextState);
                // Mission points and movement steps intentionally share a 1:1
                // routing scale: +10 lowers route cost by 10, while -10 adds 10.
                const tentativeRoutingCost = queueEntry.routingCost
                    + 1
                    - CellScoreEffectEvaluator.totalScore(newlyTriggeredEffects);
                const tentativeMovementSteps = queueEntry.movementSteps + 1;
                const existingRoutingCost = routingCosts.get(nextStateKey);
                const existingMovementSteps = movementSteps.get(nextStateKey);
                if (existingRoutingCost !== undefined
                    && existingMovementSteps !== undefined
                    && !this.isBetterRoute(tentativeRoutingCost, tentativeMovementSteps, existingRoutingCost, existingMovementSteps)) {
                    continue;
                }
                cameFrom.set(nextStateKey, queueEntry.stateKey);
                states.set(nextStateKey, nextState);
                routingCosts.set(nextStateKey, tentativeRoutingCost);
                movementSteps.set(nextStateKey, tentativeMovementSteps);
                openSet.add({
                    stateKey: nextStateKey,
                    priority: this.optimisticPriority(nextState, targetPosition, cellScoreEffects, tentativeRoutingCost),
                    routingCost: tentativeRoutingCost,
                    movementSteps: tentativeMovementSteps,
                });
            }
        }
        return bestTargetKey === undefined
            ? this.unreachablePath()
            : this.reconstructPath(cameFrom, states, bestTargetKey, routingCosts.get(bestTargetKey), cellScoreEffects);
    }
    /** A grid without directional-entry tiles has symmetric path lengths. */
    hasSymmetricPathLengths(gameMap) {
        for (let row = 0; row < gameMap.getRows(); row++) {
            for (let col = 0; col < gameMap.getCols(); col++) {
                const cell = gameMap.getCellValue(new Position(row, col));
                if (AStarPathfinder.DIRECTIONAL_TILES.has(cell)) {
                    return false;
                }
            }
        }
        return true;
    }
    isValidNeighbor(neighbor, gameMap, direction, crates) {
        if (!gameMap.isValidCoordinates(neighbor)) {
            return false;
        }
        const cell = gameMap.getCellValue(neighbor);
        if (cell === "0") {
            return false;
        }
        if (cell === "↑" && direction === "down" ||
            cell === "→" && direction === "left" ||
            cell === "↓" && direction === "up" ||
            cell === "←" && direction === "right") {
            return false;
        }
        if (cell.includes("5")) {
            for (const cratePosition of crates.values()) {
                if (cratePosition.isEqual(neighbor)) {
                    return false;
                }
            }
        }
        return true;
    }
    reconstructPath(cameFrom, states, targetStateKey, routingCost, cellScoreEffects) {
        const actions = [];
        const targetState = states.get(targetStateKey);
        const positions = [targetState.position];
        let currentStateKey = targetStateKey;
        while (cameFrom.has(currentStateKey)) {
            const previousStateKey = cameFrom.get(currentStateKey);
            const current = states.get(currentStateKey).position;
            const previous = states.get(previousStateKey).position;
            if (current.x === previous.x) {
                actions.unshift(current.y > previous.y
                    ? this.actionFactory.moveUp()
                    : this.actionFactory.moveDown());
            }
            else {
                actions.unshift(current.x > previous.x
                    ? this.actionFactory.moveRight()
                    : this.actionFactory.moveLeft());
            }
            currentStateKey = previousStateKey;
            positions.unshift(previous);
        }
        const triggeredCellEffectIds = [
            ...targetState.triggeredEffectIds,
        ];
        const triggeredIds = new Set(triggeredCellEffectIds);
        const cellScore = CellScoreEffectEvaluator.totalScore(cellScoreEffects.filter((effect) => triggeredIds.has(effect.id)));
        return {
            actions,
            positions,
            movementSteps: actions.length,
            routingCost,
            cellScore,
            triggeredCellEffectIds,
        };
    }
    optimisticPriority(state, targetPosition, cellScoreEffects, routingCost) {
        const remainingPositiveScore = cellScoreEffects.reduce((score, effect) => effect.score > 0
            && !state.triggeredEffectIds.has(effect.id)
            ? score + effect.score
            : score, 0);
        return routingCost
            + this.heuristic(state.position, targetPosition)
            - remainingPositiveScore;
    }
    isBetterRoute(candidateRoutingCost, candidateMovementSteps, existingRoutingCost, existingMovementSteps) {
        return candidateRoutingCost < existingRoutingCost
            || candidateRoutingCost === existingRoutingCost
                && candidateMovementSteps < existingMovementSteps;
    }
    searchStateKey(state) {
        const triggeredEffectIds = [...state.triggeredEffectIds].sort().join(",");
        return `${this.positionKey(state.position)}:${triggeredEffectIds}`;
    }
    unreachablePath() {
        return {
            actions: [],
            positions: [],
            movementSteps: 0,
            routingCost: Infinity,
            cellScore: 0,
            triggeredCellEffectIds: [],
        };
    }
    heuristic(first, second) {
        return first.distanceTo(second);
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
}
AStarPathfinder.DIRECTIONAL_TILES = new Set([
    "↑",
    "→",
    "↓",
    "←",
]);
//# sourceMappingURL=astar.js.map