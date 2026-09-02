import { Heap } from "heap-js";
import { GameMap } from "./map.js";
import type { Action, ActionFactory } from "./move.js";
import { Position } from "./position.js";

/** Executable movements together with every grid position visited by them. */
export interface MovementPath {
    readonly actions: Action[];
    readonly positions: readonly Position[];
}

/** Contract implemented by pathfinding algorithms. */
export abstract class BasePathfinder {
    private readonly pathLengthCache = new Map<string, number | undefined>();
    private readonly pathLengthSymmetryCache = new Map<GameMap, boolean>();

    abstract findPath(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): Action[];

    /**
     * Returns both executable actions and visited positions.
     *
     * Implementations can override this to expose intermediate positions. The fallback keeps
     * third-party pathfinders compatible while still exposing the destination for coverage.
     */
    findMovementPath(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): MovementPath {
        const actions = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
        );
        if (actions.length === 0 && !startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [] };
        }
        if (startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [startingPosition] };
        }
        return { actions, positions: [startingPosition, targetPosition] };
    }

    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): number | undefined {
        const cacheKey = this.pathLengthCacheKey(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
        );
        if (this.pathLengthCache.has(cacheKey)) {
            return this.pathLengthCache.get(cacheKey);
        }

        const path = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
        );
        const pathLength = path.length === 0 && !startingPosition.isEqual(targetPosition)
            ? undefined
            : path.length;
        this.pathLengthCache.set(cacheKey, pathLength);
        return pathLength;
    }

    /** Clears distances cached for the previous world-state deliberation. */
    clearPathLengthCache(): void {
        this.pathLengthCache.clear();
        this.pathLengthSymmetryCache.clear();
    }

    private pathLengthCacheKey(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): string {
        const startingKey = `${startingPosition.x},${startingPosition.y}`;
        const targetKey = `${targetPosition.x},${targetPosition.y}`;
        const symmetricPath = this.pathLengthsAreSymmetric(gameMap);
        const [firstPosition, secondPosition] = symmetricPath
            && targetKey < startingKey
            ? [targetKey, startingKey]
            : [startingKey, targetKey];
        const cratePositions = [...crates.values()]
            .map((crate: Position): string => `${crate.x},${crate.y}`)
            .sort()
            .join("|");
        const mapSignature = gameMap.signature();
        return `${mapSignature}:${firstPosition}:${secondPosition}:${cratePositions}`;
    }

    private pathLengthsAreSymmetric(gameMap: GameMap): boolean {
        const cachedSymmetry = this.pathLengthSymmetryCache.get(gameMap);
        if (cachedSymmetry !== undefined) {
            return cachedSymmetry;
        }

        const pathLengthsAreSymmetric = this.hasSymmetricPathLengths(gameMap);
        this.pathLengthSymmetryCache.set(gameMap, pathLengthsAreSymmetric);
        return pathLengthsAreSymmetric;
    }

    /** Reports whether forward and reverse path lengths are interchangeable. */
    protected hasSymmetricPathLengths(_gameMap: GameMap): boolean {
        return false;
    }
}

/** A* pathfinder for the grid-based game map. */
export class AStarPathfinder extends BasePathfinder {
    private static readonly DIRECTIONAL_TILES = new Set<string>([
        "↑",
        "→",
        "↓",
        "←",
    ]);

    constructor(private readonly actionFactory: ActionFactory) {
        super();
    }

    findPath(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): Action[] {
        return this.findMovementPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
        ).actions;
    }

    override findMovementPath(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
    ): MovementPath {
        if (!startingPosition.isGridAligned()) {
            return { actions: [], positions: [] };
        }

        const cameFrom = new Map<string, Position>();
        const gScore = new Map<string, number>();
        const fScore = new Map<string, number>();
        const openSet = new Heap<Position>(
            (first: Position, second: Position) =>
                fScore.get(this.positionKey(first))! - fScore.get(this.positionKey(second))!,
        );

        for (let row = 0; row < gameMap.getRows(); row++) {
            for (let column = 0; column < gameMap.getCols(); column++) {
                const key = `${row},${column}`;
                gScore.set(key, Infinity);
                fScore.set(key, Infinity);
            }
        }

        gScore.set(this.positionKey(startingPosition), 0);
        fScore.set(
            this.positionKey(startingPosition),
            this.heuristic(startingPosition, targetPosition),
        );
        openSet.add(startingPosition);

        while (openSet.size() > 0) {
            const current = openSet.pop();
            if (!current) {
                continue;
            }

            if (current.isEqual(targetPosition)) {
                return this.reconstructPath(cameFrom, current);
            }

            const neighbors = gameMap.getNeighborsOf(current);
            for (const { coord: neighbor, direction } of neighbors) {
                if (!this.isValidNeighbor(
                    neighbor,
                    gameMap,
                    direction,
                    crates,
                )) {
                    continue;
                }

                const currentScore = gScore.get(this.positionKey(current))!;
                const neighborKey = this.positionKey(neighbor);
                const tentativeScore = currentScore + 1;

                if (tentativeScore >= gScore.get(neighborKey)!) {
                    continue;
                }

                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeScore);
                fScore.set(
                    neighborKey,
                    Math.max(0, tentativeScore + this.heuristic(neighbor, targetPosition)),
                );

                if (!openSet.toArray().some((position: Position) => position.isEqual(neighbor))) {
                    openSet.add(neighbor);
                }
            }
        }

        return { actions: [], positions: [] };
    }

    /** A grid without directional-entry tiles has symmetric path lengths. */
    protected override hasSymmetricPathLengths(gameMap: GameMap): boolean {
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

    private isValidNeighbor(
        neighbor: Position,
        gameMap: GameMap,
        direction: string,
        crates: ReadonlyMap<string, Position>,
    ): boolean {
        if (!gameMap.isValidCoordinates(neighbor)) {
            return false;
        }

        const cell = gameMap.getCellValue(neighbor);
        if (cell === "0") {
            return false;
        }

        if (
            cell === "↑" && direction === "down" ||
            cell === "→" && direction === "left" ||
            cell === "↓" && direction === "up" ||
            cell === "←" && direction === "right"
        ) {
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

    private reconstructPath(
        cameFrom: ReadonlyMap<string, Position>,
        currentPosition: Position,
    ): MovementPath {
        const actions: Action[] = [];
        const positions: Position[] = [currentPosition];
        let current = currentPosition;

        while (cameFrom.has(this.positionKey(current))) {
            const previous = cameFrom.get(this.positionKey(current))!;

            if (current.x === previous.x) {
                actions.unshift(
                    current.y > previous.y
                        ? this.actionFactory.moveUp()
                        : this.actionFactory.moveDown(),
                );
            } else {
                actions.unshift(
                    current.x > previous.x
                        ? this.actionFactory.moveRight()
                        : this.actionFactory.moveLeft(),
                );
            }

            current = previous;
            positions.unshift(previous);
        }

        return { actions, positions };
    }

    private heuristic(first: Position, second: Position): number {
        return first.distanceTo(second);
    }

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }
}