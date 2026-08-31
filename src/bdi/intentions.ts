import { PDDLGoal } from "../pddl/pddlPlanner.js";
import { RewardDecayEstimator } from "../utils/_reward-decay.js";
import { BasePathfinder } from "../utils/astar.js";
import { Action, ActionFactory } from "../utils/move.js";
import { Position } from "../utils/position.js";
import type { Parcel } from "./beliefs.js";

/** Current world state and services available to an intention. */
export interface IntentionContext {
    readonly gameMap: string[][];
    readonly agentPosition: Position;
    readonly crates: ReadonlyMap<string, Position>;
    readonly pickupCells: readonly Position[];
    readonly pickupCellLastObservedAt: ReadonlyMap<string, number>;
    readonly deliveringCells: readonly Position[];
    readonly parcels: ReadonlyMap<string, Parcel>;
    readonly movementDuration: number;
    readonly frameDuration: number;
    readonly observationDistance: number;
    readonly rewardDecayInterval: number | undefined;
    readonly millisecondsUntilNextRewardDecay: number | undefined;
    readonly freeParcelsCount: number;
    readonly agentId: string;
    readonly pathfinder: BasePathfinder;
    readonly actionFactory: ActionFactory;
}

/** Structured description used to log an intention without recomputing its score. */
export type IntentionDescription =
    | {
        readonly type: "search";
        readonly target: Position | undefined;
    }
    | {
        readonly type: "pick-up";
        readonly parcelId: string;
        readonly target: Position;
        readonly reward: number;
    }
    | {
        readonly type: "deliver";
        readonly target: Position;
        readonly parcelCount: number;
        readonly estimatedGain: number;
    };

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

export abstract class Intention {
    abstract score(context: IntentionContext): number;
    abstract buildActions(context: IntentionContext): Action[];
    abstract toPddlGoal(context: IntentionContext): PDDLGoal | undefined;
    abstract describe(): IntentionDescription;

    /** Whether an empty action list means the intention is already fulfilled. */
    isSatisfied(_context: IntentionContext): boolean {
        return false;
    }

    /** Adds intention-specific actions after PDDL has reached the target. */
    buildPddlCompletionActions(_context: IntentionContext): Action[] {
        return [];
    }

    /** Manhattan distance used to prefer the closest option when scores are equal. */
    selectionDistance(_context: IntentionContext): number | undefined {
        return undefined;
    }

    shouldInterrupt(_context: IntentionContext): boolean {
        return false;
    }

    /** Records state that is valid only after every planned action was executed. */
    onPlanCompleted(_context: IntentionContext): void { }
}

/** Base for intentions whose score depends on reward decay during execution. */
export abstract class RewardIntention extends Intention {
    /**
     * Predicts the integer reward remaining after the real action-loop delays.
     * Each move incurs a client wait, server movement, and frame synchronization.
     */
    protected estimateReward(
        reward: number,
        movementCount: number,
        extraWaitCount: number,
        movementDuration: number,
        frameDuration: number,
        rewardDecayInterval: number | undefined,
        millisecondsUntilNextDecay: number | undefined,
    ): number {
        const executionMilliseconds =
            RewardDecayEstimator.actionSequenceDurationMilliseconds(
                movementCount,
                extraWaitCount,
                movementDuration,
                frameDuration,
            );
        return RewardDecayEstimator.remainingReward(
            reward,
            executionMilliseconds,
            rewardDecayInterval,
            millisecondsUntilNextDecay,
        );
    }
}

/** Explores parcel pickup cells when no more valuable intention exists. */
export class SearchIntention extends Intention {
    private static readonly PATH_CANDIDATE_LIMIT = 8;

    private targetLocation: Position | undefined;
    private clusters: PickupCluster[];
    private pickupCellsSignature: string;
    private readonly knownFreeParcelIdsAtPlanning: Set<string>;
    private plannedCluster: PickupCluster | undefined;
    private plannedCoverageComplete: boolean;
    private planningSatisfied: boolean;

    constructor() {
        super();
        this.targetLocation = undefined;
        this.clusters = [];
        this.pickupCellsSignature = "";
        this.knownFreeParcelIdsAtPlanning = new Set<string>();
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
        this.planningSatisfied = false;
    }

    score(_context: IntentionContext): number {
        return 0;
    }

    buildActions(context: IntentionContext): Action[] {
        this.rememberKnownFreeParcels(context.parcels);
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
                cluster.lastFullyVisitedAt = Date.now();
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

        this.planningSatisfied = !incompleteClusterFound;
        return [];
    }

    override isSatisfied(_context: IntentionContext): boolean {
        return this.planningSatisfied;
    }

    shouldInterrupt(context: IntentionContext): boolean {
        for (const parcel of context.parcels.values()) {
            if (
                !parcel.carriedBy
                && !this.knownFreeParcelIdsAtPlanning.has(parcel.id)
            ) {
                return true;
            }
        }
        return false;
    }

    override onPlanCompleted(_context: IntentionContext): void {
        if (!this.plannedCoverageComplete || !this.plannedCluster) {
            return;
        }
        this.plannedCluster.lastFullyVisitedAt = Date.now();
        this.plannedCluster.scanStartedAt = undefined;
        this.plannedCluster.remainingCellKeys = undefined;
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
    }

    describe(): IntentionDescription {
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

    toPddlGoal(context: IntentionContext): PDDLGoal | undefined {
        if (!this.targetLocation) {
            return undefined;
        }

        return {
            agentId: context.agentId,
            finalTargetPosition: this.targetLocation
        }
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

    private rememberKnownFreeParcels(
        parcels: ReadonlyMap<string, Parcel>,
    ): void {
        this.knownFreeParcelIdsAtPlanning.clear();
        for (const parcel of parcels.values()) {
            if (!parcel.carriedBy) {
                this.knownFreeParcelIdsAtPlanning.add(parcel.id);
            }
        }
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
        context: IntentionContext,
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

    private buildCoveragePlan(
        context: IntentionContext,
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
        context: IntentionContext,
        cluster: PickupCluster,
    ): Position[] {
        const candidates: Position[] = [];
        for (let x = 0; x < context.gameMap.length; x++) {
            for (let y = 0; y < context.gameMap[0].length; y++) {
                if (context.gameMap[x][y] === "0") {
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

    private positionKey(position: Position): string {
        return `${position.x},${position.y}`;
    }
}

/** Picks up a known parcel when its expected reward is positive. */
export class PickUpParcelIntention extends RewardIntention {
    constructor(
        readonly parcel: Parcel,
        readonly parcelPosition: Position,
    ) {
        super();
    }

    score(context: IntentionContext): number {
        const pickupDistance = context.pathfinder.pathLengthAllowingCrateMoves(
            context,
            context.agentPosition,
            this.parcelPosition,
        );
        if (pickupDistance === undefined) {
            return -1;
        }

        let shortestDeliveryDistance: number | undefined;
        for (const deliveryCell of context.deliveringCells) {
            const deliveryDistance = context.pathfinder.pathLengthAllowingCrateMoves(
                context,
                this.parcelPosition,
                deliveryCell,
            );
            if (deliveryDistance === undefined) {
                continue;
            }
            if (
                shortestDeliveryDistance === undefined
                || deliveryDistance < shortestDeliveryDistance
            ) {
                shortestDeliveryDistance = deliveryDistance;
            }
        }

        if (shortestDeliveryDistance === undefined) {
            return -1;
        }

        const totalMovementCount = pickupDistance + shortestDeliveryDistance;
        const candidateReward = this.estimateReward(
            this.parcel.reward,
            totalMovementCount,
            3,
            context.movementDuration,
            context.frameDuration,
            context.rewardDecayInterval,
            context.millisecondsUntilNextRewardDecay,
        );
        if (candidateReward === 0) {
            return -1;
        }

        let totalReward = candidateReward;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                totalReward += this.estimateReward(
                    parcel.reward,
                    totalMovementCount,
                    3,
                    context.movementDuration,
                    context.frameDuration,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                );
            }
        }
        return totalReward;
    }

    selectionDistance(context: IntentionContext): number | undefined {
        return context.pathfinder.pathLengthAllowingCrateMoves(
            context,
            context.agentPosition,
            this.parcelPosition,
        );
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.parcelPosition,
            context.crates,
        );

        if (actions.length > 0 || context.agentPosition.isEqual(this.parcelPosition))
            actions.push(context.actionFactory.pickUp(this.parcel.id, context.agentId));

        return actions;
    }

    toPddlGoal(context: IntentionContext): PDDLGoal {
        return {
            agentId: context.agentId,
            finalTargetPosition: this.parcelPosition
        }
    }

    override buildPddlCompletionActions(context: IntentionContext): Action[] {
        return [context.actionFactory.pickUp(this.parcel.id, context.agentId)];
    }

    describe(): IntentionDescription {
        return {
            type: "pick-up",
            parcelId: this.parcel.id,
            target: this.parcelPosition,
            reward: this.parcel.reward,
        };
    }
}

/** Delivers all parcels currently carried by the agent. */
export class DeliverParcelIntention extends RewardIntention {
    private readonly knownFreeParcelIds: ReadonlySet<string>;
    private carriedParcelCount: number;
    private estimatedDeliveryGain: number;

    constructor(
        readonly deliveryCell: Position,
        knownFreeParcelIds: ReadonlySet<string>,
    ) {
        super();
        this.knownFreeParcelIds = new Set(knownFreeParcelIds);
        this.carriedParcelCount = 0;
        this.estimatedDeliveryGain = 0;
    }

    score(context: IntentionContext): number {
        this.carriedParcelCount = 0;
        this.estimatedDeliveryGain = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                this.carriedParcelCount += 1;
            }
        }

        const firstDeliveryDistance = context.pathfinder.pathLengthAllowingCrateMoves(
            context,
            context.agentPosition,
            this.deliveryCell,
        );
        if (firstDeliveryDistance === undefined) {
            return -1;
        }

        let carriedReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedReward += this.estimateReward(
                    parcel.reward,
                    firstDeliveryDistance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                );
            }
        }
        this.estimatedDeliveryGain = carriedReward;
        if (carriedReward === 0) {
            return -1;
        }

        let bestContinuationReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }

            const parcelPosition = new Position(parcel.x, parcel.y);
            const pickupDistance = context.pathfinder.pathLengthAllowingCrateMoves(
                context,
                this.deliveryCell,
                parcelPosition,
            );
            if (pickupDistance === undefined) {
                continue;
            }

            let shortestDeliveryDistance: number | undefined;
            for (const finalDeliveryCell of context.deliveringCells) {
                const deliveryDistance = context.pathfinder.pathLengthAllowingCrateMoves(
                    context,
                    parcelPosition,
                    finalDeliveryCell,
                );
                if (deliveryDistance === undefined) {
                    continue;
                }
                if (
                    shortestDeliveryDistance === undefined
                    || deliveryDistance < shortestDeliveryDistance
                ) {
                    shortestDeliveryDistance = deliveryDistance;
                }
            }

            if (shortestDeliveryDistance === undefined) {
                continue;
            }

            const totalMovementCount = firstDeliveryDistance
                + pickupDistance
                + shortestDeliveryDistance;
            bestContinuationReward = Math.max(
                bestContinuationReward,
                this.estimateReward(
                    parcel.reward,
                    totalMovementCount,
                    5,
                    context.movementDuration,
                    context.frameDuration,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                ),
            );
        }

        return carriedReward + bestContinuationReward;
    }

    selectionDistance(context: IntentionContext): number | undefined {
        return context.pathfinder.pathLengthAllowingCrateMoves(
            context,
            context.agentPosition,
            this.deliveryCell,
        );
    }

    buildActions(context: IntentionContext): Action[] {
        const actions = context.pathfinder.findPath(
            context.gameMap,
            context.agentPosition,
            this.deliveryCell,
            context.crates,
        );

        if (actions.length > 0 || context.agentPosition.isEqual(this.deliveryCell))
            actions.push(context.actionFactory.drop(context.agentId));
        return actions;
    }

    shouldInterrupt(context: IntentionContext): boolean {
        let freeParcelCount = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            freeParcelCount += 1;
            if (!this.knownFreeParcelIds.has(parcel.id)) {
                return true;
            }
        }
        return freeParcelCount !== this.knownFreeParcelIds.size;
    }

    toPddlGoal(context: IntentionContext): PDDLGoal {
        return {
            agentId: context.agentId,
            finalTargetPosition: this.deliveryCell
        }
    }

    override buildPddlCompletionActions(context: IntentionContext): Action[] {
        return [context.actionFactory.drop(context.agentId)];
    }

    describe(): IntentionDescription {
        return {
            type: "deliver",
            target: this.deliveryCell,
            parcelCount: this.carriedParcelCount,
            estimatedGain: this.estimatedDeliveryGain,
        };
    }
}
