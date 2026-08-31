import { Heap } from "heap-js";
import { IntentionContext } from "./intentions.js";
import { CoordinateOffset, Direction } from "./map.js";
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
    private readonly pathLengthSymmetryCache = new Map<string[][], boolean>();

    abstract findPath(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): Action[];

    /**
     * Returns both executable actions and visited positions.
     *
     * Implementations can override this to expose intermediate positions. The fallback keeps
     * third-party pathfinders compatible while still exposing the destination for coverage.
     */
    findMovementPath(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): MovementPath {
        const actions = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            temporarilyLocked,
        );
        if (actions.length === 0 && !startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [] };
        }
        if (startingPosition.isEqual(targetPosition)) {
            return { actions, positions: [startingPosition] };
        }
        return { actions, positions: [startingPosition, targetPosition] };
    }

    /**
     * Estimates a route while treating known crates as movable obstacles.
     *
     * A direct A* route is preferred. If crates are the only thing blocking it,
     * the crate-free distance keeps the intention eligible so PDDL can plan the
     * required crate moves.
     */
    pathLengthAllowingCrateMoves(
        context: IntentionContext,
        startingPosition: Position,
        targetPosition: Position,
    ): number | undefined {
        const directDistance = this.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            context.crates,
        );
        if (directDistance !== undefined || context.crates.size === 0) {
            return directDistance;
        }

        return this.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            new Map<string, Position>(),
        );
    }

    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): number | undefined {
        const cacheKey = this.pathLengthCacheKey(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            temporarilyLocked,
        );
        if (this.pathLengthCache.has(cacheKey)) {
            return this.pathLengthCache.get(cacheKey);
        }

        const path = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            temporarilyLocked,
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
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): string {
        const mapSignature = JSON.stringify(gameMap);
        const startingKey = `${startingPosition.x},${startingPosition.y}`;
        const targetKey = `${targetPosition.x},${targetPosition.y}`;
        const symmetricPath = temporarilyLocked === undefined
            && this.pathLengthsAreSymmetric(gameMap);
        const [firstPosition, secondPosition] = symmetricPath
            && targetKey < startingKey
            ? [targetKey, startingKey]
            : [startingKey, targetKey];
        const lockedPosition = temporarilyLocked
            ? `${temporarilyLocked.x},${temporarilyLocked.y}`
            : "none";
        const cratePositions = [...crates.values()]
            .map((crate: Position): string => `${crate.x},${crate.y}`)
            .sort()
            .join("|");
        return `${mapSignature}:${firstPosition}:${secondPosition}:${lockedPosition}:${cratePositions}`;
    }

    private pathLengthsAreSymmetric(gameMap: string[][]): boolean {
        const cachedSymmetry = this.pathLengthSymmetryCache.get(gameMap);
        if (cachedSymmetry !== undefined) {
            return cachedSymmetry;
        }

        const pathLengthsAreSymmetric = this.hasSymmetricPathLengths(gameMap);
        this.pathLengthSymmetryCache.set(gameMap, pathLengthsAreSymmetric);
        return pathLengthsAreSymmetric;
    }

    /** Reports whether forward and reverse path lengths are interchangeable. */
    protected hasSymmetricPathLengths(_gameMap: string[][]): boolean {
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
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): Action[] {
        return this.findMovementPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            temporarilyLocked,
        ).actions;
    }

    override findMovementPath(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
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

        for (let row = 0; row < gameMap.length; row++) {
            for (let column = 0; column < gameMap[0].length; column++) {
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

        const offsets: CoordinateOffset[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const directions: Direction[] = ["up", "down", "right", "left"];

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

                if (!this.isValidCell(
                    neighbor,
                    gameMap,
                    directions[index],
                    crates,
                    temporarilyLocked,
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
    protected override hasSymmetricPathLengths(gameMap: string[][]): boolean {
        for (const column of gameMap) {
            for (const tile of column) {
                if (AStarPathfinder.DIRECTIONAL_TILES.has(tile)) {
                    return false;
                }
            }
        }
        return true;
    }

    private isValidCell(
        neighbor: Position,
        gameMap: string[][],
        direction: Direction,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): boolean {
        if (
            neighbor.x < 0 ||
            neighbor.x >= gameMap.length ||
            neighbor.y < 0 ||
            neighbor.y >= gameMap[0].length
        ) {
            return false;
        }

        const cell = gameMap[neighbor.x][neighbor.y];
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

        if (temporarilyLocked?.isEqual(neighbor)) {
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
