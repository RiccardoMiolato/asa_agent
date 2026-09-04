import { PlanningObjective, } from "../planning.js";
import { Position } from "../utils/position.js";
/** A goal to which the agent has committed. */
export class Intention extends PlanningObjective {
    /** Records state that is valid only after the complete plan was executed. */
    onPlanCompleted() { }
}
/** Commits one evaluator-selected desire without duplicating its goal data. */
export class CommittedDesireIntention extends Intention {
    constructor(desire) {
        super();
        this.desire = desire;
    }
    describe() {
        return this.desire.describe();
    }
}
/** Explores parcel pickup cells when no more valuable intention exists. */
export class SearchIntention extends Intention {
    constructor() {
        super();
        this.targetLocation = undefined;
        this.clusters = [];
        this.pickupCellsSignature = "";
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
        this.planningSatisfied = false;
    }
    buildActions(context) {
        this.synchronizeClusters(context.pickupCells);
        this.targetLocation = undefined;
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
        this.planningSatisfied = false;
        let incompleteClusterFound = false;
        let partialFallback;
        const oldestClusters = [...this.clusters].sort((first, second) => {
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
        });
        for (const cluster of oldestClusters) {
            const checkpoint = this.makeClusterCheckpoint(context, cluster);
            const plan = this.buildCoveragePlan(context, cluster, checkpoint.remainingCellKeys);
            if (!plan.complete) {
                incompleteClusterFound = true;
                const planWithMovableCrates = context.crates.size > 0
                    ? this.buildCoveragePlan(context, cluster, checkpoint.remainingCellKeys, new Map())
                    : undefined;
                if (planWithMovableCrates?.complete
                    && planWithMovableCrates.actions.length > 0) {
                    // PDDL may use a different route from the optimistic A* path,
                    // so the next sensing checkpoint must verify actual coverage.
                    this.rememberPlannedCluster(cluster, checkpoint, planWithMovableCrates.target, false);
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
                if (this.clusterContainsPosition(cluster, context.agentPosition)) {
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
            this.rememberPlannedCluster(partialFallback.cluster, partialFallback.checkpoint, partialFallback.coverage.target, false);
            return partialFallback.coverage.actions;
        }
        const revisitActions = this.buildClusterRevisitActions(context, oldestClusters);
        if (revisitActions !== undefined) {
            return revisitActions;
        }
        this.planningSatisfied = !incompleteClusterFound;
        return [];
    }
    isSatisfied() {
        return this.planningSatisfied;
    }
    onPlanCompleted() {
        if (!this.plannedCoverageComplete || !this.plannedCluster) {
            return;
        }
        this.recordClusterVisit(this.plannedCluster);
        this.plannedCluster.scanStartedAt = undefined;
        this.plannedCluster.remainingCellKeys = undefined;
        this.plannedCluster = undefined;
        this.plannedCoverageComplete = false;
    }
    describe() {
        return {
            type: "search",
            target: this.targetLocation,
        };
    }
    /** Describes pickup clusters without exposing mutable search-planning state. */
    clusterSnapshots(pickupCells, pickupCellLastObservedAt) {
        this.synchronizeClusters(pickupCells);
        const lastSeenAtById = new Map(this.clusters.map((cluster) => [
            cluster.id,
            this.clusterLastSeenAt(cluster, pickupCellLastObservedAt),
        ]));
        const visitOrderById = new Map(this.clusters
            .filter((cluster) => lastSeenAtById.get(cluster.id) !== undefined)
            .sort((first, second) => (lastSeenAtById.get(first.id) ?? 0)
            - (lastSeenAtById.get(second.id) ?? 0))
            .map((cluster, index) => [
            cluster.id,
            index,
        ]));
        return this.clusters.map((cluster) => ({
            id: cluster.id,
            cells: cluster.cells.map((cell) => new Position(cell.x, cell.y)),
            lastVisitedAt: cluster.lastFullyVisitedAt,
            lastSeenAt: lastSeenAtById.get(cluster.id),
            visitOrder: visitOrderById.get(cluster.id),
            active: cluster === this.plannedCluster,
            stripedCells: this.clusterCellsSeenDuringCurrentScan(cluster, pickupCellLastObservedAt),
        }));
    }
    target() {
        return this.targetLocation;
    }
    clusterCellsSeenDuringCurrentScan(cluster, pickupCellLastObservedAt) {
        const scanStartedAt = cluster.scanStartedAt;
        if (scanStartedAt === undefined) {
            return [];
        }
        return cluster.cells
            .filter((cell) => {
            const key = this.positionKey(cell);
            const observedAt = pickupCellLastObservedAt.get(key);
            const coveredAtScanStart = cluster.remainingCellKeys !== undefined
                && !cluster.remainingCellKeys.has(key);
            return coveredAtScanStart
                || (observedAt !== undefined
                    && observedAt >= scanStartedAt);
        })
            .map((cell) => new Position(cell.x, cell.y));
    }
    clusterLastSeenAt(cluster, pickupCellLastObservedAt) {
        let latestObservation;
        for (const cell of cluster.cells) {
            const observedAt = pickupCellLastObservedAt.get(this.positionKey(cell));
            if (observedAt !== undefined
                && (latestObservation === undefined
                    || observedAt > latestObservation)) {
                latestObservation = observedAt;
            }
        }
        return latestObservation;
    }
    synchronizeClusters(pickupCells) {
        const signature = pickupCells
            .map((position) => this.positionKey(position))
            .sort()
            .join("|");
        if (signature === this.pickupCellsSignature) {
            return;
        }
        const previousClusters = new Map(this.clusters.map((cluster) => [
            cluster.id,
            cluster,
        ]));
        this.clusters = this.makeClusters(pickupCells).map((cluster) => {
            const previousCluster = previousClusters.get(cluster.id);
            return {
                ...cluster,
                lastFullyVisitedAt: previousCluster?.lastFullyVisitedAt,
                scanStartedAt: previousCluster?.scanStartedAt,
                remainingCellKeys: previousCluster?.remainingCellKeys,
            };
        });
        this.pickupCellsSignature = signature;
    }
    makeClusters(pickupCells) {
        const cellsByKey = new Map(pickupCells.map((cell) => [
            this.positionKey(cell),
            cell,
        ]));
        const unassignedKeys = new Set(cellsByKey.keys());
        const clusters = [];
        const neighborOffsets = [
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
            const pendingKeys = [firstKey];
            const clusterCells = [];
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
                    const neighborKey = this.positionKey(new Position(currentCell.x + xOffset, currentCell.y + yOffset));
                    if (!unassignedKeys.delete(neighborKey)) {
                        continue;
                    }
                    pendingKeys.push(neighborKey);
                }
            }
            const clusterKeys = clusterCells
                .map((cell) => this.positionKey(cell))
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
    makeClusterCheckpoint(context, cluster) {
        const scanStartedAt = cluster.scanStartedAt ?? Date.now();
        const remainingCellKeys = cluster.remainingCellKeys
            ? new Set(cluster.remainingCellKeys)
            : new Set(cluster.cells.map((cell) => this.positionKey(cell)));
        for (const cellKey of remainingCellKeys) {
            const lastObservedAt = context.pickupCellLastObservedAt.get(cellKey);
            if (lastObservedAt !== undefined && lastObservedAt >= scanStartedAt) {
                remainingCellKeys.delete(cellKey);
            }
        }
        this.removeCoveredKeys(remainingCellKeys, cluster.cells, [context.agentPosition], context.observationDistance);
        return { scanStartedAt, remainingCellKeys };
    }
    rememberPlannedCluster(cluster, checkpoint, target, coverageComplete) {
        cluster.scanStartedAt = checkpoint.scanStartedAt;
        cluster.remainingCellKeys = checkpoint.remainingCellKeys;
        this.targetLocation = target;
        this.plannedCluster = cluster;
        this.plannedCoverageComplete = coverageComplete;
    }
    /** Plans a physical transfer when sensing already covers every cluster. */
    buildClusterRevisitActions(context, oldestClusters) {
        const remoteClusters = oldestClusters.filter((cluster) => !this.clusterContainsPosition(cluster, context.agentPosition));
        const localClusters = oldestClusters.filter((cluster) => this.clusterContainsPosition(cluster, context.agentPosition));
        for (const cluster of [...remoteClusters, ...localClusters]) {
            const destinations = [...cluster.cells]
                .filter((cell) => !cell.isEqual(context.agentPosition))
                .sort((first, second) => context.agentPosition.distanceTo(first)
                - context.agentPosition.distanceTo(second));
            for (const destination of destinations) {
                const movementPath = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, destination, context.crates, context.cellScoreEffects);
                if (movementPath.actions.length > 0) {
                    this.rememberPlannedCluster(cluster, this.makeClusterCheckpoint(context, cluster), destination, true);
                    return movementPath.actions;
                }
                if (context.crates.size === 0) {
                    continue;
                }
                const pathWithMovableCrates = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, destination, new Map(), context.cellScoreEffects);
                if (pathWithMovableCrates.actions.length === 0) {
                    continue;
                }
                this.rememberPlannedCluster(cluster, this.makeClusterCheckpoint(context, cluster), destination, false);
                return [];
            }
        }
        return undefined;
    }
    buildCoveragePlan(context, cluster, requiredCellKeys, crates = context.crates) {
        const uncoveredKeys = new Set(requiredCellKeys);
        const actions = [];
        let cursor = context.agentPosition;
        const candidates = this.makeCoverageCandidates(context, cluster);
        let remainingCellScoreEffects = [...context.cellScoreEffects];
        while (uncoveredKeys.size > 0) {
            let bestSegment;
            let evaluatedPathCount = 0;
            for (const candidate of this.rankCoverageCandidates(candidates, cursor, uncoveredKeys, cluster.cells, context.observationDistance)) {
                const movementPath = context.pathfinder.findMovementPath(context.gameMap, cursor, candidate.destination, crates, remainingCellScoreEffects);
                if (movementPath.positions.length === 0) {
                    continue;
                }
                evaluatedPathCount += 1;
                const newlyCoveredKeys = this.coveredKeys(uncoveredKeys, cluster.cells, movementPath.positions, context.observationDistance);
                if (newlyCoveredKeys.length === 0) {
                    continue;
                }
                const utility = newlyCoveredKeys.length
                    / (movementPath.actions.length + 1);
                const segment = {
                    actions: movementPath.actions,
                    destination: candidate.destination,
                    newlyCoveredKeys,
                    utility,
                    triggeredCellEffectIds: movementPath.triggeredCellEffectIds,
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
            const triggeredCellEffectIds = new Set(bestSegment.triggeredCellEffectIds);
            remainingCellScoreEffects = remainingCellScoreEffects.filter((effect) => !triggeredCellEffectIds.has(effect.id));
        }
        return { actions, target: cursor, complete: true };
    }
    rankCoverageCandidates(candidates, cursor, uncoveredKeys, clusterCells, observationDistance) {
        const rankedCandidates = [];
        for (const destination of candidates) {
            const destinationCoverage = this.coveredKeys(uncoveredKeys, clusterCells, [destination], observationDistance).length;
            if (destinationCoverage === 0) {
                continue;
            }
            rankedCandidates.push({
                destination,
                estimatedUtility: destinationCoverage
                    / (cursor.distanceTo(destination) + 1),
            });
        }
        rankedCandidates.sort((first, second) => second.estimatedUtility - first.estimatedUtility);
        return rankedCandidates;
    }
    makeCoverageCandidates(context, cluster) {
        const candidates = [];
        for (let x = 0; x < context.gameMap.getRows(); x++) {
            for (let y = 0; y < context.gameMap.getCols(); y++) {
                if (context.gameMap.getCellValue(new Position(x, y)) === "0") {
                    continue;
                }
                const candidate = new Position(x, y);
                if (context.observationDistance === -1
                    || cluster.cells.some((cell) => candidate.distanceTo(cell)
                        <= context.observationDistance)) {
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }
    coveredKeys(uncoveredKeys, clusterCells, observationPositions, observationDistance) {
        const coveredKeys = [];
        for (const cell of clusterCells) {
            const cellKey = this.positionKey(cell);
            if (!uncoveredKeys.has(cellKey)) {
                continue;
            }
            if (observationDistance === -1
                || observationPositions.some((position) => position.distanceTo(cell)
                    <= observationDistance)) {
                coveredKeys.push(cellKey);
            }
        }
        return coveredKeys;
    }
    removeCoveredKeys(uncoveredKeys, clusterCells, observationPositions, observationDistance) {
        for (const coveredKey of this.coveredKeys(uncoveredKeys, clusterCells, observationPositions, observationDistance)) {
            uncoveredKeys.delete(coveredKey);
        }
    }
    isBetterCoverageSegment(candidate, currentBest) {
        if (!currentBest || candidate.utility !== currentBest.utility) {
            return !currentBest || candidate.utility > currentBest.utility;
        }
        if (candidate.newlyCoveredKeys.length !== currentBest.newlyCoveredKeys.length) {
            return candidate.newlyCoveredKeys.length
                > currentBest.newlyCoveredKeys.length;
        }
        return candidate.actions.length < currentBest.actions.length;
    }
    distanceToCluster(position, cluster) {
        return Math.min(...cluster.cells.map((cell) => position.distanceTo(cell)));
    }
    clusterContainsPosition(cluster, position) {
        return cluster.cells.some((cell) => cell.isEqual(position));
    }
    /** Preserves visit ordering even when several completions share one millisecond. */
    recordClusterVisit(cluster) {
        const latestVisit = Math.max(0, ...this.clusters.map((candidate) => candidate.lastFullyVisitedAt ?? 0));
        cluster.lastFullyVisitedAt = Math.max(Date.now(), latestVisit + 1);
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
}
SearchIntention.PATH_CANDIDATE_LIMIT = 8;
//# sourceMappingURL=intentions.js.map