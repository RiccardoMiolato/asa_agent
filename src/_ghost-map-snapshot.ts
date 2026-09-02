import type { Agent } from "./agent.js";
import type { Beliefs } from "./bdi/beliefs.js";
import type { PickupClusterSnapshot } from "./bdi/intentions.js";
import type { PlanningObjectiveDescription } from "./planning.js";
import { Position } from "./utils/position.js";

export interface GhostMapTarget {
    readonly position: Position;
    readonly intention: PlanningObjectiveDescription["type"];
}

export interface GhostMapAgentState {
    readonly id: string;
    readonly name: string;
    readonly position: Position;
    readonly score: number | undefined;
    readonly deliberationCycle: number;
}

export interface GhostMapParcel {
    readonly id: string;
    readonly position: Position;
    readonly reward: number;
    readonly carriedBy: string | null;
    readonly lastObservedAt: number;
}

export interface GhostMapSnapshot {
    readonly schemaVersion: 5;
    readonly updatedAt: number;
    readonly sensingRevision: number;
    readonly ready: boolean;
    readonly map: {
        readonly width: number;
        readonly height: number;
        readonly revision: number;
        readonly tiles?: readonly (readonly string[])[];
    };
    readonly agent: GhostMapAgentState;
    readonly target: GhostMapTarget | undefined;
    readonly temporaryWalls: readonly Position[];
    readonly pickupClusters: readonly PickupClusterSnapshot[];
    readonly stripedPickupCells: readonly Position[];
    readonly knownParcels: readonly GhostMapParcel[];
}

/** Builds an immutable, serializable view of the agent's private world model. */
export class AgentGhostMapSnapshotProvider {
    constructor(
        private readonly agent: Agent,
        private readonly beliefs: Beliefs,
        private readonly agentName: string,
    ) { }

    snapshot(includeMapTiles: boolean = true): GhostMapSnapshot {
        const decision = this.agent.currentDecision();
        const pickupClusters = this.agent.pickupClusterSnapshots();
        return {
            schemaVersion: 5,
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
                position: new Position(
                    this.agent.position.x,
                    this.agent.position.y,
                ),
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
            stripedPickupCells: pickupClusters.flatMap(
                (cluster): readonly Position[] => cluster.stripedCells,
            ),
            knownParcels: [...this.beliefs.parcels.values()]
                .filter(
                    (parcel): boolean => !parcel.carriedBy
                        || parcel.carriedBy === this.agent.id,
                )
                .map(
                    (parcel): GhostMapParcel => ({
                        id: parcel.id,
                        position: new Position(parcel.x, parcel.y),
                        reward: parcel.reward,
                        carriedBy: parcel.carriedBy ?? null,
                        lastObservedAt: parcel.lastUpdate.getTime(),
                    }),
                ),
        };
    }
}
