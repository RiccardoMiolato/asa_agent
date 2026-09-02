import {
    PlanningObjective,
    type PlanningContext,
    type PlanningObjectiveDescription,
} from "../planning.js";
import type { Action } from "../utils/move.js";
import { Position } from "../utils/position.js";
import type { Desire } from "./desires.js";

interface PickupCluster {
    readonly id: string;
    readonly cells: readonly Position[];
    lastFullyVisitedAt: number | undefined;
    scanStartedAt: number | undefined;
    remainingCellKeys: Set<string> | undefined;
}

/** Read-only search history used by observers such as the ghost map. */
export interface PickupClusterSnapshot {
    readonly id: string;
    readonly cells: readonly Position[];
    readonly lastVisitedAt: number | undefined;
    readonly lastSeenAt: number | undefined;
    readonly visitOrder: number | undefined;
    readonly active: boolean;
    readonly stripedCells: readonly Position[];
}

interface ClusterCheckpoint {
    readonly scanStartedAt: number;
    readonly remainingCellKeys: Set<string>;
}

interface ClusterCoveragePlan {
    readonly actions: Action[];
    readonly target: Position;
    readonly complete: boolean;
}

interface PartialClusterCoveragePlan {
    readonly cluster: PickupCluster;
    readonly checkpoint: ClusterCheckpoint;
    readonly coverage: ClusterCoveragePlan;
}

interface CoverageSegment {
    readonly actions: Action[];
    readonly destination: Position;
    readonly newlyCoveredKeys: readonly string[];
    readonly utility: number;
}

interface RankedCoverageCandidate {
    readonly destination: Position;
    readonly estimatedUtility: number;
}

/** A goal to which the agent has committed. */
export abstract class Intention extends PlanningObjective {
    /** Records state that is valid only after the complete plan was executed. */
    onPlanCompleted(): void { }
}

/** Commits one evaluator-selected desire without duplicating its goal data. */
export class CommittedDesireIntention extends Intention {
    constructor(readonly desire: Desire) {
        super();
    }

    describe(): PlanningObjectiveDescription {
        return this.desire.describe();
    }
}

/** Explores parcel pickup cells when no more valuable intention exists. */
export class SearchIntention extends Intention {
    private static readonly PATH_CANDIDATE_LIMIT = 8;

    private targetLocation: Position | undefined;
    private clusters: PickupCluster[];
    private pickupCellsSignature: string;
    private plannedCluster: PickupCluster | undefined;
    private plannedCoverageComplete: boolean;
    private planningSatisfied: boolean;

    constructor() {
        super();
        this.targetLocation = undefined;
        this.clusters = [];
        this.pickupCellsSignature = "";
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
        this.planningSatisfied = false;
    }

    buildActions(context: PlanningContext): Action[] {
        this.synchronizeClusters(context.pickupCells);
        this.targetLocation = undefined;
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
        this.planningSatisfied = false;
        let incompleteClusterFound = false;
        let partialFallback: PartialClusterCoveragePlan | undefined;

        const oldestClusters = [...this.clusters].sort(
            (first: PickupCluster, second: PickupCluster): number => {
                const firstIsActive = first.scanStartedAt !== undefined;
                const secondIsActive = second.scanStartedAt !== undefined;
                if (firstIsActive !== secondIsActive) {
                    return firstIsActive ? -1 : 1;
                }
                const firstVisit = first.lastFullyVisitedAt
                    ?? Number.NEGATIVE_INFINITY;
                const secondVisit = second.lastFullyVisitedAt
                    ?? Number.NEGATIVE_INFINITY;
                if (firstVisit !== secondVisit) {
                    return firstVisit - secondVisit;
                }
                return this.distanceToCluster(context.agentPosition, first)
                    - this.distanceToCluster(context.agentPosition, second);
            },
        );

        for (const cluster of oldestClusters) {
            const checkpoint = this.makeClusterCheckpoint(context, cluster);
            const plan = this.buildCoveragePlan(
                context,
                cluster,
                checkpoint.remainingCellKeys,
            );
            if (!plan.complete) {
                incompleteClusterFound = true;
                const planWithMovableCrates = context.crates.size > 0
                    ? this.buildCoveragePlan(
                        context,
                        cluster,
                        checkpoint.remainingCellKeys,
                        new Map<string, Position>(),
                    )
                    : undefined;
                if (
                    planWithMovableCrates?.complete
                    && planWithMovableCrates.actions.length > 0
                ) {
                    // PDDL may use a different route from the optimistic A* path,
                    // so the next sensing checkpoint must verify actual coverage.
                    this.rememberPlannedCluster(
                        cluster,
                        checkpoint,
                        planWithMovableCrates.target,
                        false,
                    );
                    return [];
                }

                if (cluster.scanStartedAt !== undefined) {
                    cluster.remainingCellKeys = checkpoint.remainingCellKeys;
                }
                if (plan.actions.length > 0 && !partialFallback) {
                    partialFallback = {
                        cluster,
                        checkpoint,
                        coverage: plan,
                    };
                }
                continue;
            }

            cluster.scanStartedAt = checkpoint.scanStartedAt;
            cluster.remainingCellKeys = checkpoint.remainingCellKeys;
            if (plan.actions.length === 0) {
                if (this.clusterContainsPosition(
                    cluster,
                    context.agentPosition,
                )) {
                    this.recordClusterVisit(cluster);
                }
                cluster.scanStartedAt = undefined;
                cluster.remainingCellKeys = undefined;
                continue;
            }
            this.rememberPlannedCluster(cluster, checkpoint, plan.target, true);
            return plan.actions;
        }

        if (partialFallback) {
            this.rememberPlannedCluster(
                partialFallback.cluster,
                partialFallback.checkpoint,
                partialFallback.coverage.target,
                false,
            );
            return partialFallback.coverage.actions;
        }

        const revisitActions = this.buildClusterRevisitActions(
            context,
            oldestClusters,
        );
        if (revisitActions !== undefined) {
            return revisitActions;
        }

        this.planningSatisfied = !incompleteClusterFound;
        return [];
    }

    isSatisfied(): boolean {
        return this.planningSatisfied;
    }

    onPlanCompleted(): void {
        if (!this.plannedCoverageComplete || !this.plannedCluster) {
            return;
        }
        this.recordClusterVisit(this.plannedCluster);
        this.plannedCluster.scanStartedAt = undefined;
        this.plannedCluster.remainingCellKeys = undefined;
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
    }

    describe(): PlanningObjectiveDescription {
        return {
            type: "search",
            target: this.targetLocation,
        };
    }

    /** Describes pickup clusters without exposing mutable search-planning state. */
    clusterSnapshots(
        pickupCells: readonly Position[],
        pickupCellLastObservedAt: ReadonlyMap<string, number>,
    ): readonly PickupClusterSnapshot[] {
        this.synchronizeClusters(pickupCells);
        const lastSeenAtById = new Map<string, number | undefined>(
            this.clusters.map(
                (cluster: PickupCluster): [string, number | undefined] => [
                    cluster.id,
                    this.clusterLastSeenAt(cluster, pickupCellLastObservedAt),
                ],
            ),
        );
        const visitOrderById = new Map<string, number>(
            this.clusters
                .filter(
                    (cluster: PickupCluster): boolean =>
                        lastSeenAtById.get(cluster.id) !== undefined,
                )
                .sort(
                    (first: PickupCluster, second: PickupCluster): number =>
                        (lastSeenAtById.get(first.id) ?? 0)
                        - (lastSeenAtById.get(second.id) ?? 0),
                )
                .map(
                    (cluster: PickupCluster, index: number): [string, number] => [
                        cluster.id,
                        index,
                    ],
                ),
        );

        return this.clusters.map(
            (cluster: PickupCluster): PickupClusterSnapshot => ({
                id: cluster.id,
                cells: cluster.cells.map(
                    (cell: Position): Position => new Position(cell.x, cell.y),
                ),
                lastVisitedAt: cluster.lastFullyVisitedAt,
                lastSeenAt: lastSeenAtById.get(cluster.id),
                visitOrder: visitOrderById.get(cluster.id),
                active: cluster === this.plannedCluster,
                stripedCells: this.clusterCellsSeenDuringCurrentScan(
                    cluster,
                    pickupCellLastObservedAt,
                ),
            }),
        );
    }

    target(): Position | undefined {
        return this.targetLocation;
    }

    private clusterCellsSeenDuringCurrentScan(
        cluster: PickupCluster,
        pickupCellLastObservedAt: ReadonlyMap<string, number>,
    ): Position[] {
        const scanStartedAt = cluster.scanStartedAt;
        if (scanStartedAt === undefined) {
            return [];
        }

        return cluster.cells
            .filter((cell: Position): boolean => {
                const key = this.positionKey(cell);
                const observedAt = pickupCellLastObservedAt.get(key);
                const coveredAtScanStart = cluster.remainingCellKeys !== undefined
                    && !cluster.remainingCellKeys.has(key);
                return coveredAtScanStart
                    || (observedAt !== undefined
                        && observedAt >= scanStartedAt);
            })
            .map(
                (cell: Position): Position => new Position(cell.x, cell.y),
            );
    }

    private clusterLastSeenAt(
        cluster: PickupCluster,
        pickupCellLastObservedAt: ReadonlyMap<string, number>,
    ): number | undefined {
        let latestObservation: number | undefined;
        for (const cell of cluster.cells) {
            const observedAt = pickupCellLastObservedAt.get(
                this.positionKey(cell),
            );
            if (
                observedAt !== undefined
                && (latestObservation === undefined
                    || observedAt > latestObservation)
            ) {
                latestObservation = observedAt;
            }
        }
        return latestObservation;
    }

    private synchronizeClusters(pickupCells: readonly Position[]): void {
        const signature = pickupCells
            .map((position: Position): string => this.positionKey(position))
            .sort()
            .join("|");
        if (signature === this.pickupCellsSignature) {
            return;
        }

        const previousClusters = new Map<string, PickupCluster>(
            this.clusters.map(
                (cluster: PickupCluster): [string, PickupCluster] => [
                    cluster.id,
                    cluster,
                ],
            ),
        );
        this.clusters = this.makeClusters(pickupCells).map(
            (cluster: PickupCluster): PickupCluster => {
                const previousCluster = previousClusters.get(cluster.id);
                return {
                    ...cluster,
                    lastFullyVisitedAt: previousCluster?.lastFullyVisitedAt,
                    scanStartedAt: previousCluster?.scanStartedAt,
                    remainingCellKeys: previousCluster?.remainingCellKeys,
                };
            },
        );
        this.pickupCellsSignature = signature;
    }

    private makeClusters(pickupCells: readonly Position[]): PickupCluster[] {
        const cellsByKey = new Map<string, Position>(
            pickupCells.map((cell: Position): [string, Position] => [
                this.positionKey(cell),
                cell,
            ]),
        );
        const unassignedKeys = new Set(cellsByKey.keys());
        const clusters: PickupCluster[] = [];
        const neighborOffsets: readonly (readonly [number, number])[] = [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
        ];

        while (unassignedKeys.size > 0) {
            const firstKey = unassignedKeys.values().next().value;
            if (firstKey === undefined) {
                break;
            }

            const pendingKeys: string[] = [firstKey];
            const clusterCells: Position[] = [];
            unassignedKeys.delete(firstKey);

            while (pendingKeys.length > 0) {
                const currentKey = pendingKeys.pop();
                if (currentKey === undefined) {
                    continue;
                }
                const currentCell = cellsByKey.get(currentKey);
                if (!currentCell) {
                    continue;
                }
                clusterCells.push(currentCell);

                for (const [xOffset, yOffset] of neighborOffsets) {
                    const neighborKey = this.positionKey(
                        new Position(
                            currentCell.x + xOffset,
                            currentCell.y + yOffset,
                        ),
                    );
                    if (!unassignedKeys.delete(neighborKey)) {
                        continue;
                    }
                    pendingKeys.push(neighborKey);
                }
            }

            const clusterKeys = clusterCells
                .map((cell: Position): string => this.positionKey(cell))
                .sort();
            clusters.push({
                id: clusterKeys.join("|"),
                cells: clusterCells,
                lastFullyVisitedAt: undefined,
                scanStartedAt: undefined,
                remainingCellKeys: undefined,
            });
        }

        return clusters;
    }

    private makeClusterCheckpoint(
        context: PlanningContext,
        cluster: PickupCluster,
    ): ClusterCheckpoint {
        const scanStartedAt = cluster.scanStartedAt ?? Date.now();
        const remainingCellKeys = cluster.remainingCellKeys
            ? new Set(cluster.remainingCellKeys)
            : new Set(
                cluster.cells.map(
                    (cell: Position): string => this.positionKey(cell),
                ),
            );

        for (const cellKey of remainingCellKeys) {
            const lastObservedAt = context.pickupCellLastObservedAt.get(cellKey);
            if (lastObservedAt !== undefined && lastObservedAt >= scanStartedAt) {
                remainingCellKeys.delete(cellKey);
            }
        }
        this.removeCoveredKeys(
            remainingCellKeys,
            cluster.cells,
            [context.agentPosition],
            context.observationDistance,
        );

        return { scanStartedAt, remainingCellKeys };
    }

    private rememberPlannedCluster(
        cluster: PickupCluster,
        checkpoint: ClusterCheckpoint,
        target: Position,
        coverageComplete: boolean,
    ): void {
        cluster.scanStartedAt = checkpoint.scanStartedAt;
        cluster.remainingCellKeys = checkpoint.remainingCellKeys;
        this.targetLocation = target;
        this.plannedCluster = cluster;
        this.plannedCoverageComplete = coverageComplete;
    }

    /** Plans a physical transfer when sensing already covers every cluster. */
    private buildClusterRevisitActions(
        context: PlanningContext,
        oldestClusters: readonly PickupCluster[],
    ): Action[] | undefined {
        const remoteClusters = oldestClusters.filter(
            (cluster: PickupCluster): boolean =>
                !this.clusterContainsPosition(cluster, context.agentPosition),
        );
        const localClusters = oldestClusters.filter(
            (cluster: PickupCluster): boolean =>
                this.clusterContainsPosition(cluster, context.agentPosition),
        );

        for (const cluster of [...remoteClusters, ...localClusters]) {
            const destinations = [...cluster.cells]
                .filter(
                    (cell: Position): boolean =>
                        !cell.isEqual(context.agentPosition),
                )
                .sort(
                    (first: Position, second: Position): number =>
                        context.agentPosition.distanceTo(first)
                        - context.agentPosition.distanceTo(second),
                );
            for (const destination of destinations) {
                const movementPath = context.pathfinder.findMovementPath(
                    context.gameMap,
                    context.agentPosition,
                    destination,
                    context.crates,
                );
                if (movementPath.actions.length > 0) {
                    this.rememberPlannedCluster(
                        cluster,
                        this.makeClusterCheckpoint(context, cluster),
                        destination,
                        true,
                    );
                    return movementPath.actions;
                }

                if (context.crates.size === 0) {
                    continue;
                }
                const pathWithMovableCrates =
                    context.pathfinder.findMovementPath(
                        context.gameMap,
                        context.agentPosition,
                        destination,
                        new Map<string, Position>(),
                    );
                if (pathWithMovableCrates.actions.length === 0) {
                    continue;
                }

                this.rememberPlannedCluster(
                    cluster,
                    this.makeClusterCheckpoint(context, cluster),
                    destination,
                    false,
                );
                return [];
            }
        }

        return undefined;
    }

    private buildCoveragePlan(
        context: PlanningContext,
        cluster: PickupCluster,
        requiredCellKeys: ReadonlySet<string>,
        crates: ReadonlyMap<string, Position> = context.crates,
    ): ClusterCoveragePlan {
        const uncoveredKeys = new Set(requiredCellKeys);
        const actions: Action[] = [];
        let cursor = context.agentPosition;
        const candidates = this.makeCoverageCandidates(context, cluster);

        while (uncoveredKeys.size > 0) {
            let bestSegment: CoverageSegment | undefined;
            let evaluatedPathCount = 0;

            for (const candidate of this.rankCoverageCandidates(
                candidates,
                cursor,
                uncoveredKeys,
                cluster.cells,
                context.observationDistance,
            )) {
                const movementPath = context.pathfinder.findMovementPath(
                    context.gameMap,
                    cursor,
                    candidate.destination,
                    crates,
                );
                if (movementPath.positions.length === 0) {
                    continue;
                }
                evaluatedPathCount += 1;

                const newlyCoveredKeys = this.coveredKeys(
                    uncoveredKeys,
                    cluster.cells,
                    movementPath.positions,
                    context.observationDistance,
                );
                if (newlyCoveredKeys.length === 0) {
                    continue;
                }

                const utility = newlyCoveredKeys.length
                    / (movementPath.actions.length + 1);
                const segment: CoverageSegment = {
                    actions: movementPath.actions,
                    destination: candidate.destination,
                    newlyCoveredKeys,
                    utility,
                };
                if (this.isBetterCoverageSegment(segment, bestSegment)) {
                    bestSegment = segment;
                }
                if (evaluatedPathCount >= SearchIntention.PATH_CANDIDATE_LIMIT) {
                    break;
                }
            }

            if (!bestSegment) {
                return { actions, target: cursor, complete: false };
            }

            actions.push(...bestSegment.actions);
            for (const coveredKey of bestSegment.newlyCoveredKeys) {
                uncoveredKeys.delete(coveredKey);
            }
            cursor = bestSegment.destination;
        }

        return { actions, target: cursor, complete: true };
    }

    private rankCoverageCandidates(
        candidates: readonly Position[],
        cursor: Position,
        uncoveredKeys: ReadonlySet<string>,
        clusterCells: readonly Position[],
        observationDistance: number,
    ): RankedCoverageCandidate[] {
        const rankedCandidates: RankedCoverageCandidate[] = [];
        for (const destination of candidates) {
            const destinationCoverage = this.coveredKeys(
                uncoveredKeys,
                clusterCells,
                [destination],
                observationDistance,
            ).length;
            if (destinationCoverage === 0) {
                continue;
            }
            rankedCandidates.push({
                destination,
                estimatedUtility: destinationCoverage
                    / (cursor.distanceTo(destination) + 1),
            });
        }
        rankedCandidates.sort(
            (
                first: RankedCoverageCandidate,
                second: RankedCoverageCandidate,
            ): number => second.estimatedUtility - first.estimatedUtility,
        );
        return rankedCandidates;
    }

    private makeCoverageCandidates(
        context: PlanningContext,
        cluster: PickupCluster,
    ): Position[] {
        const candidates: Position[] = [];
        for (let x = 0; x < context.gameMap.getRows(); x++) {
            for (let y = 0; y < context.gameMap.getCols(); y++) {
                if (context.gameMap.getCellValue(new Position(x,y)) === "0") {
                    continue;
                }

                const candidate = new Position(x, y);
                if (
                    context.observationDistance === -1
                    || cluster.cells.some(
                        (cell: Position): boolean => candidate.distanceTo(cell)
                            <= context.observationDistance,
                    )
                ) {
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }

    private coveredKeys(
        uncoveredKeys: ReadonlySet<string>,
        clusterCells: readonly Position[],
        observationPositions: readonly Position[],
        observationDistance: number,
    ): string[] {
        const coveredKeys: string[] = [];
        for (const cell of clusterCells) {
            const cellKey = this.positionKey(cell);
            if (!uncoveredKeys.has(cellKey)) {
                continue;
            }
            if (
                observationDistance === -1
                || observationPositions.some(
                    (position: Position): boolean => position.distanceTo(cell)
                        <= observationDistance,
                )
            ) {
                coveredKeys.push(cellKey);
            }
        }
        return coveredKeys;
    }

    private removeCoveredKeys(
        uncoveredKeys: Set<string>,
        clusterCells: readonly Position[],
        observationPositions: readonly Position[],
        observationDistance: number,
    ): void {
        for (const coveredKey of this.coveredKeys(
            uncoveredKeys,
            clusterCells,
            observationPositions,
            observationDistance,
        )) {
            uncoveredKeys.delete(coveredKey);
        }
    }

    private isBetterCoverageSegment(
        candidate: CoverageSegment,
        currentBest: CoverageSegment | undefined,
    ): boolean {
        if (!currentBest || candidate.utility !== currentBest.utility) {
            return !currentBest || candidate.utility > currentBest.utility;
        }
        if (candidate.newlyCoveredKeys.length !== currentBest.newlyCoveredKeys.length) {
            return candidate.newlyCoveredKeys.length
                > currentBest.newlyCoveredKeys.length;
        }
        return candidate.actions.length < currentBest.actions.length;
    }

    private distanceToCluster(position: Position, cluster: PickupCluster): number {
        return Math.min(
            ...cluster.cells.map(
                (cell: Position): number => position.distanceTo(cell),
            ),
        );
    }

    private clusterContainsPosition(
        cluster: PickupCluster,
        position: Position,
    ): boolean {
        return cluster.cells.some(
            (cell: Position): boolean => cell.isEqual(position),
        );
    }

    /** Preserves visit ordering even when several completions share one millisecond. */
    private recordClusterVisit(cluster: PickupCluster): void {
        const latestVisit = Math.max(
            0,
            ...this.clusters.map(
                (candidate: PickupCluster): number =>
                    candidate.lastFullyVisitedAt ?? 0,
            ),
        );
        cluster.lastFullyVisitedAt = Math.max(Date.now(), latestVisit + 1);
    }

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }
}
