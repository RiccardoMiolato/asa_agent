import { Position } from "./utils/position.js";
/** Builds an immutable, serializable view of the agent's private world model. */
export class AgentGhostMapSnapshotProvider {
    constructor(agent, beliefs, agentName) {
        this.agent = agent;
        this.beliefs = beliefs;
        this.agentName = agentName;
    }
    snapshot(includeMapTiles = true) {
        const decision = this.agent.currentDecision();
        const pickupClusters = this.agent.pickupClusterSnapshots();
        return {
            schemaVersion: 6,
            updatedAt: Date.now(),
            sensingRevision: this.beliefs.currentSensingRevision(),
            ready: this.beliefs.map.getRows() > 0 && this.agent.id.length > 0,
            map: {
                width: this.beliefs.map.getRows(),
                height: this.beliefs.map.getCols() ?? 0,
                revision: this.beliefs.currentMapRevision(),
                tiles: includeMapTiles ? this.beliefs.map.getTiles() : undefined,
            },
            agent: {
                id: this.agent.id,
                name: this.agentName,
                position: new Position(this.agent.position.x, this.agent.position.y),
                score: this.agent.currentScore(),
                deliberationCycle: this.agent.currentDeliberationCycle(),
            },
            target: decision.target
                ? {
                    position: new Position(decision.target.x, decision.target.y),
                    intention: decision.type,
                }
                : undefined,
            temporaryWalls: this.agent.temporaryBlockedCellSnapshots(),
            pickupClusters,
            stripedPickupCells: pickupClusters.flatMap((cluster) => cluster.stripedCells),
            activeMissions: this.agent.activeMissionDescriptions(),
            knownParcels: [...this.beliefs.parcels.values()]
                .filter((parcel) => !parcel.carriedBy
                || parcel.carriedBy === this.agent.id)
                .map((parcel) => ({
                id: parcel.id,
                position: new Position(parcel.x, parcel.y),
                reward: parcel.reward,
                carriedBy: parcel.carriedBy ?? null,
                lastObservedAt: parcel.lastUpdate.getTime(),
            })),
        };
    }
}
//# sourceMappingURL=_ghost-map-snapshot.js.map