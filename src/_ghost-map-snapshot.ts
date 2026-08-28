import type { Agent } from "./agent.js";
import type { Beliefs } from "./beliefs.js";
import type { IntentionDescription, PickupClusterSnapshot } from "./intentions.js";
import { Position } from "./position.js";

export interface GhostMapTarget {
    readonly position: Position;
    readonly intention: IntentionDescription["type"];
}

export interface GhostMapAgentState {
    readonly id: string;
    readonly name: string;
    readonly position: Position;
    readonly score: number | undefined;
    readonly deliberationCycle: number;
}

export interface GhostMapSnapshot {
    readonly updatedAt: number;
    readonly ready: boolean;
    readonly map: {
        readonly width: number;
        readonly height: number;
        readonly tiles: readonly (readonly string[])[];
    };
    readonly agent: GhostMapAgentState;
    readonly target: GhostMapTarget | undefined;
    readonly temporaryWalls: readonly Position[];
    readonly pickupClusters: readonly PickupClusterSnapshot[];
}

/** Builds an immutable, serializable view of the agent's private world model. */
export class AgentGhostMapSnapshotProvider {
    constructor(
        private readonly agent: Agent,
        private readonly beliefs: Beliefs,
        private readonly agentName: string,
    ) { }

    snapshot(): GhostMapSnapshot {
        const decision = this.agent.currentDecision();
        return {
            updatedAt: Date.now(),
            ready: this.beliefs.map.length > 0 && this.agent.id.length > 0,
            map: {
                width: this.beliefs.map.length,
                height: this.beliefs.map[0]?.length ?? 0,
                tiles: this.beliefs.map,
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
            pickupClusters: this.agent.pickupClusterSnapshots(),
        };
    }
}
