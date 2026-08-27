import { Heap } from "heap-js";
import type { Action, ActionFactory } from "./move.js";
import { Position } from "./position.js";

type Direction = "up" | "down" | "right" | "left";
type CoordinateOffset = readonly [x: number, y: number];

/** Contract implemented by pathfinding algorithms. */
export abstract class BasePathfinder {
    abstract findPath(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): Action[];

    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(
        gameMap: string[][],
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        temporarilyLocked?: Position,
    ): number | undefined {
        const path = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            temporarilyLocked,
        );
        if (path.length === 0 && !startingPosition.isEqual(targetPosition)) {
            return undefined;
        }
        return path.length;
    }
}

/** A* pathfinder for the grid-based game map. */
export class AStarPathfinder extends BasePathfinder {
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
        if (startingPosition.x % 1 !== 0 || startingPosition.y % 1 !== 0) {
            return [];
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

        return [];
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

        if (cell.includes("5")) {
            for (const cratePosition of crates.values()) {
                if (cratePosition.isEqual(neighbor)) {
                    return false;
                }
            }
        } else if (temporarilyLocked && neighbor.isEqual(temporarilyLocked)) {
            return false;
        }

        return true;
    }

    private reconstructPath(
        cameFrom: ReadonlyMap<string, Position>,
        currentPosition: Position,
    ): Action[] {
        const actions: Action[] = [];
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
        }

        return actions;
    }

    private heuristic(first: Position, second: Position): number {
        return first.distanceTo(second);
    }

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }
}
