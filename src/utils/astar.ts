import { Heap } from "heap-js";
import {
    CellScoreEffect,
    CellScoreEffectEvaluator,
    type CellScoreEffectId,
} from "./_cell-score-effects.js";
import { GameMap } from "./map.js";
import type { Action, ActionFactory } from "./move.js";
import { Position } from "./position.js";

/** Executable movements together with every grid position visited by them. */
export interface MovementPath {
    readonly actions: Action[];
    readonly positions: readonly Position[];
    /** Physical moves used for elapsed-time and reward-decay calculations. */
    readonly movementSteps: number;
    /** Internal A* objective: movement steps minus triggered score effects. */
    readonly routingCost: number;
    /** Signed game-score change caused by cells entered along this route. */
    readonly cellScore: number;
    readonly triggeredCellEffectIds: readonly CellScoreEffectId[];
}

interface WeightedSearchState {
    readonly position: Position;
    readonly triggeredEffectIds: ReadonlySet<CellScoreEffectId>;
}

interface WeightedSearchQueueEntry {
    readonly stateKey: string;
    readonly priority: number;
    readonly routingCost: number;
    readonly movementSteps: number;
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
        cellScoreEffects?: readonly CellScoreEffect[],
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
        cellScoreEffects: readonly CellScoreEffect[] = [],
    ): MovementPath {
        const actions = this.findPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            cellScoreEffects,
        );
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

        const triggeredEffects = CellScoreEffectEvaluator.triggeredAt(
            targetPosition,
            cellScoreEffects,
            new Set<CellScoreEffectId>(),
        );
        const cellScore = CellScoreEffectEvaluator.totalScore(triggeredEffects);
        return {
            actions,
            positions: [startingPosition, targetPosition],
            movementSteps: actions.length,
            routingCost: actions.length - cellScore,
            cellScore,
            triggeredCellEffectIds: triggeredEffects.map(
                (effect: CellScoreEffect): CellScoreEffectId => effect.id,
            ),
        };
    }

    /** Returns the route length, or `undefined` when the target is unreachable. */
    pathLength(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        cellScoreEffects: readonly CellScoreEffect[] = [],
    ): number | undefined {
        const cacheKey = this.pathLengthCacheKey(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            cellScoreEffects,
        );
        if (this.pathLengthCache.has(cacheKey)) {
            return this.pathLengthCache.get(cacheKey);
        }

        const path = this.findMovementPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            cellScoreEffects,
        );
        const pathLength = path.positions.length === 0
            ? undefined
            : path.movementSteps;
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
        cellScoreEffects: readonly CellScoreEffect[],
    ): string {
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
            .map((crate: Position): string => `${crate.x},${crate.y}`)
            .sort()
            .join("|");
        const mapSignature = gameMap.signature();
        const effectsSignature = CellScoreEffectEvaluator.signature(
            cellScoreEffects,
        );
        return `${mapSignature}:${firstPosition}:${secondPosition}:${cratePositions}:${effectsSignature}`;
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
        cellScoreEffects: readonly CellScoreEffect[] = [],
    ): Action[] {
        return this.findMovementPath(
            gameMap,
            startingPosition,
            targetPosition,
            crates,
            cellScoreEffects,
        ).actions;
    }

    override findMovementPath(
        gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        crates: ReadonlyMap<string, Position>,
        cellScoreEffects: readonly CellScoreEffect[] = [],
    ): MovementPath {
        if (!startingPosition.isGridAligned()) {
            return this.unreachablePath();
        }

        const cameFrom = new Map<string, string>();
        const states = new Map<string, WeightedSearchState>();
        const routingCosts = new Map<string, number>();
        const movementSteps = new Map<string, number>();
        const openSet = new Heap<WeightedSearchQueueEntry>(
            (
                first: WeightedSearchQueueEntry,
                second: WeightedSearchQueueEntry,
            ): number => first.priority - second.priority,
        );
        const initialState: WeightedSearchState = {
            position: startingPosition,
            triggeredEffectIds: new Set<CellScoreEffectId>(),
        };
        const initialKey = this.searchStateKey(initialState);
        states.set(initialKey, initialState);
        routingCosts.set(initialKey, 0);
        movementSteps.set(initialKey, 0);
        openSet.add({
            stateKey: initialKey,
            priority: this.optimisticPriority(
                initialState,
                targetPosition,
                cellScoreEffects,
                0,
            ),
            routingCost: 0,
            movementSteps: 0,
        });

        let bestTargetKey: string | undefined;
        while (openSet.size() > 0) {
            if (
                bestTargetKey !== undefined
                && openSet.peek()!.priority
                    > routingCosts.get(bestTargetKey)!
            ) {
                break;
            }
            const queueEntry = openSet.pop();
            if (!queueEntry) {
                continue;
            }
            if (
                routingCosts.get(queueEntry.stateKey)
                    !== queueEntry.routingCost
                || movementSteps.get(queueEntry.stateKey)
                    !== queueEntry.movementSteps
            ) {
                continue;
            }

            const current = states.get(queueEntry.stateKey);
            if (!current) {
                continue;
            }
            if (current.position.isEqual(targetPosition)) {
                if (
                    bestTargetKey === undefined
                    || this.isBetterRoute(
                        queueEntry.routingCost,
                        queueEntry.movementSteps,
                        routingCosts.get(bestTargetKey)!,
                        movementSteps.get(bestTargetKey)!,
                    )
                ) {
                    bestTargetKey = queueEntry.stateKey;
                }
                // Reaching an objective completes the route; do not leave and re-enter it.
                continue;
            }

            const neighbors = gameMap.getNeighborsOf(current.position);
            for (const { coord: neighbor, direction } of neighbors) {
                if (!this.isValidNeighbor(
                    neighbor,
                    gameMap,
                    direction,
                    crates,
                )) {
                    continue;
                }

                const newlyTriggeredEffects =
                    CellScoreEffectEvaluator.triggeredAt(
                        neighbor,
                        cellScoreEffects,
                        current.triggeredEffectIds,
                    );
                const nextTriggeredEffectIds = new Set(
                    current.triggeredEffectIds,
                );
                for (const effect of newlyTriggeredEffects) {
                    nextTriggeredEffectIds.add(effect.id);
                }
                const nextState: WeightedSearchState = {
                    position: neighbor,
                    triggeredEffectIds: nextTriggeredEffectIds,
                };
                const nextStateKey = this.searchStateKey(nextState);
                // Mission points and movement steps intentionally share a 1:1
                // routing scale: +10 lowers route cost by 10, while -10 adds 10.
                const tentativeRoutingCost = queueEntry.routingCost
                    + 1
                    - CellScoreEffectEvaluator.totalScore(
                        newlyTriggeredEffects,
                    );
                const tentativeMovementSteps = queueEntry.movementSteps + 1;
                const existingRoutingCost = routingCosts.get(nextStateKey);
                const existingMovementSteps = movementSteps.get(nextStateKey);
                if (
                    existingRoutingCost !== undefined
                    && existingMovementSteps !== undefined
                    && !this.isBetterRoute(
                        tentativeRoutingCost,
                        tentativeMovementSteps,
                        existingRoutingCost,
                        existingMovementSteps,
                    )
                ) {
                    continue;
                }

                cameFrom.set(nextStateKey, queueEntry.stateKey);
                states.set(nextStateKey, nextState);
                routingCosts.set(nextStateKey, tentativeRoutingCost);
                movementSteps.set(nextStateKey, tentativeMovementSteps);
                openSet.add({
                    stateKey: nextStateKey,
                    priority: this.optimisticPriority(
                        nextState,
                        targetPosition,
                        cellScoreEffects,
                        tentativeRoutingCost,
                    ),
                    routingCost: tentativeRoutingCost,
                    movementSteps: tentativeMovementSteps,
                });
            }
        }

        return bestTargetKey === undefined
            ? this.unreachablePath()
            : this.reconstructPath(
                cameFrom,
                states,
                bestTargetKey,
                routingCosts.get(bestTargetKey)!,
                cellScoreEffects,
            );
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
        cameFrom: ReadonlyMap<string, string>,
        states: ReadonlyMap<string, WeightedSearchState>,
        targetStateKey: string,
        routingCost: number,
        cellScoreEffects: readonly CellScoreEffect[],
    ): MovementPath {
        const actions: Action[] = [];
        const targetState = states.get(targetStateKey)!;
        const positions: Position[] = [targetState.position];
        let currentStateKey = targetStateKey;

        while (cameFrom.has(currentStateKey)) {
            const previousStateKey = cameFrom.get(currentStateKey)!;
            const current = states.get(currentStateKey)!.position;
            const previous = states.get(previousStateKey)!.position;

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

            currentStateKey = previousStateKey;
            positions.unshift(previous);
        }

        const triggeredCellEffectIds = [
            ...targetState.triggeredEffectIds,
        ];
        const triggeredIds = new Set(triggeredCellEffectIds);
        const cellScore = CellScoreEffectEvaluator.totalScore(
            cellScoreEffects.filter(
                (effect: CellScoreEffect): boolean =>
                    triggeredIds.has(effect.id),
            ),
        );
        return {
            actions,
            positions,
            movementSteps: actions.length,
            routingCost,
            cellScore,
            triggeredCellEffectIds,
        };
    }

    private optimisticPriority(
        state: WeightedSearchState,
        targetPosition: Position,
        cellScoreEffects: readonly CellScoreEffect[],
        routingCost: number,
    ): number {
        const remainingPositiveScore = cellScoreEffects.reduce(
            (score: number, effect: CellScoreEffect): number =>
                effect.score > 0
                    && !state.triggeredEffectIds.has(effect.id)
                    ? score + effect.score
                    : score,
            0,
        );
        return routingCost
            + this.heuristic(state.position, targetPosition)
            - remainingPositiveScore;
    }

    private isBetterRoute(
        candidateRoutingCost: number,
        candidateMovementSteps: number,
        existingRoutingCost: number,
        existingMovementSteps: number,
    ): boolean {
        return candidateRoutingCost < existingRoutingCost
            || candidateRoutingCost === existingRoutingCost
                && candidateMovementSteps < existingMovementSteps;
    }

    private searchStateKey(state: WeightedSearchState): string {
        const triggeredEffectIds = [...state.triggeredEffectIds].sort().join(",");
        return `${this.positionKey(state.position)}:${triggeredEffectIds}`;
    }

    private unreachablePath(): MovementPath {
        return {
            actions: [],
            positions: [],
            movementSteps: 0,
            routingCost: Infinity,
            cellScore: 0,
            triggeredCellEffectIds: [],
        };
    }

    private heuristic(first: Position, second: Position): number {
        return first.distanceTo(second);
    }

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }
}
