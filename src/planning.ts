import type { Parcel } from "./bdi/beliefs.js";
import type { IOSensedAgent } from "../types/IOSensing.js";
import type { BaseDeliveryScoreEffect } from "./_delivery-scoring.js";
import type { CellScoreEffect } from "./utils/_cell-score-effects.js";
import type { BasePathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import type { ActionFactory } from "./utils/move.js";
import type { Position } from "./utils/position.js";

/** Immutable world state and services shared by all planning strategies. */
export interface PlanningContext {
    readonly gameMap: GameMap;
    readonly agentPosition: Position;
    readonly crates: ReadonlyMap<string, Position>;
    readonly pickupCells: readonly Position[];
    readonly pickupCellLastObservedAt: ReadonlyMap<string, number>;
    readonly deliveringCells: readonly Position[];
    readonly parcels: ReadonlyMap<string, Parcel>;
    /** Parcels reserved by coordination and unavailable to ordinary pickup. */
    readonly pickupExcludedParcelIds: ReadonlySet<string>;
    /** Other agents present in the latest authoritative sensing snapshot. */
    readonly sensedAgents: ReadonlyMap<string, IOSensedAgent>;
    readonly movementDuration: number;
    readonly frameDuration: number;
    readonly observationDistance: number;
    readonly rewardDecayInterval: number | undefined;
    readonly millisecondsUntilNextRewardDecay: number | undefined;
    readonly agentId: string;
    readonly pathfinder: BasePathfinder;
    readonly actionFactory: ActionFactory;
    /** Active one-shot score changes caused by entering mission cells. */
    readonly cellScoreEffects: readonly CellScoreEffect[];
    /** Active one-shot and persistent delivery score transformations. */
    readonly deliveryScoreEffects: readonly BaseDeliveryScoreEffect[];
}

/** Stable, structured description of the objective currently being executed. */
export type PlanningObjectiveDescription =
    | {
        readonly type: "search";
        readonly target: Position | undefined;
    }
    | {
        readonly type: "pick-up";
        readonly parcelId: string;
        readonly target: Position;
    }
    | {
        readonly type: "deliver";
        readonly target: Position;
        readonly waitMilliseconds: number;
    }
    | {
        readonly type: "visit";
        readonly missionId: string;
        readonly score: number;
        readonly target: Position;
    }
    | {
        readonly type: "parcel-handoff";
        readonly phase:
            | "wait"
            | "pick-up"
            | "stage"
            | "release"
            | "collect"
            | "deliver";
        readonly parcelId: string | undefined;
        readonly target: Position | undefined;
    };

/** Common observable contract for evaluator options and exploration intentions. */
export abstract class PlanningObjective {
    abstract describe(): PlanningObjectiveDescription;
}
