import { Heap } from "heap-js";
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
    findMovementPath(gameMap, startingPosition, targetPosition, crates) {
        const actions = this.findPath(gameMap, startingPosition, targetPosition, crates);
        if (actions.length === 0 && !startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [] };
        }
        if (startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [startingPosition] };
        }
        return { actions, positions: [startingPosition, targetPosition] };
    }
    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(gameMap, startingPosition, targetPosition, crates) {
        const cacheKey = this.pathLengthCacheKey(gameMap, startingPosition, targetPosition, crates);
        if (this.pathLengthCache.has(cacheKey)) {
            return this.pathLengthCache.get(cacheKey);
        }
        const path = this.findPath(gameMap, startingPosition, targetPosition, crates);
        const pathLength = path.length === 0 && !startingPosition.isEqual(targetPosition)
            ? undefined
            : path.length;
        this.pathLengthCache.set(cacheKey, pathLength);
        return pathLength;
    }
    /** Clears distances cached for the previous world-state deliberation. */
    clearPathLengthCache() {
        this.pathLengthCache.clear();
        this.pathLengthSymmetryCache.clear();
    }
    pathLengthCacheKey(gameMap, startingPosition, targetPosition, crates) {
        const mapSignature = JSON.stringify(gameMap);
        const startingKey = `${startingPosition.x},${startingPosition.y}`;
        const targetKey = `${targetPosition.x},${targetPosition.y}`;
        const symmetricPath = this.pathLengthsAreSymmetric(gameMap);
        const [firstPosition, secondPosition] = symmetricPath
            && targetKey < startingKey
            ? [targetKey, startingKey]
            : [startingKey, targetKey];
        const cratePositions = [...crates.values()]
            .map((crate) => `${crate.x},${crate.y}`)
            .sort()
            .join("|");
        return `${mapSignature}:${firstPosition}:${secondPosition}:${cratePositions}`;
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
    findPath(gameMap, startingPosition, targetPosition, crates) {
        return this.findMovementPath(gameMap, startingPosition, targetPosition, crates).actions;
    }
    findMovementPath(gameMap, startingPosition, targetPosition, crates) {
        if (!startingPosition.isGridAligned()) {
            return { actions: [], positions: [] };
        }
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        const openSet = new Heap((first, second) => fScore.get(this.positionKey(first)) - fScore.get(this.positionKey(second)));
        for (let row = 0; row < gameMap.length; row++) {
            for (let column = 0; column < gameMap[0].length; column++) {
                const key = `${row},${column}`;
                gScore.set(key, Infinity);
                fScore.set(key, Infinity);
            }
        }
        gScore.set(this.positionKey(startingPosition), 0);
        fScore.set(this.positionKey(startingPosition), this.heuristic(startingPosition, targetPosition));
        openSet.add(startingPosition);
        const offsets = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const directions = ["up", "down", "right", "left"];
        while (openSet.size() > 0) {
            const current = openSet.pop();
            if (!current) {
                continue;
            }
            if (current.isEqual(targetPosition)) {
                return this.reconstructPath(cameFrom, current);
            }
            for (let index = 0; index < offsets.length; index++) {
                const offset = offsets[index];
                const neighbor = new Position(current.x + offset[0], current.y + offset[1]);
                if (!this.isValidCell(neighbor, gameMap, directions[index], crates)) {
                    continue;
                }
                const currentScore = gScore.get(this.positionKey(current));
                const neighborKey = this.positionKey(neighbor);
                const tentativeScore = currentScore + 1;
                if (tentativeScore >= gScore.get(neighborKey)) {
                    continue;
                }
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeScore);
                fScore.set(neighborKey, Math.max(0, tentativeScore + this.heuristic(neighbor, targetPosition)));
                if (!openSet.toArray().some((position) => position.isEqual(neighbor))) {
                    openSet.add(neighbor);
                }
            }
        }
        return { actions: [], positions: [] };
    }
    /** A grid without directional-entry tiles has symmetric path lengths. */
    hasSymmetricPathLengths(gameMap) {
        for (const column of gameMap) {
            for (const tile of column) {
                if (AStarPathfinder.DIRECTIONAL_TILES.has(tile)) {
                    return false;
                }
            }
        }
        return true;
    }
    isValidCell(neighbor, gameMap, direction, crates) {
        if (neighbor.x < 0 ||
            neighbor.x >= gameMap.length ||
            neighbor.y < 0 ||
            neighbor.y >= gameMap[0].length) {
            return false;
        }
        const cell = gameMap[neighbor.x][neighbor.y];
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
    reconstructPath(cameFrom, currentPosition) {
        const actions = [];
        const positions = [currentPosition];
        let current = currentPosition;
        while (cameFrom.has(this.positionKey(current))) {
            const previous = cameFrom.get(this.positionKey(current));
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
            current = previous;
            positions.unshift(previous);
        }
        return { actions, positions };
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