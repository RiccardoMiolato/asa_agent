import type { Parcel } from "./bdi/beliefs.js";
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
    readonly movementDuration: number;
    readonly frameDuration: number;
    readonly observationDistance: number;
    readonly rewardDecayInterval: number | undefined;
    readonly millisecondsUntilNextRewardDecay: number | undefined;
    readonly agentId: string;
    readonly pathfinder: BasePathfinder;
    readonly actionFactory: ActionFactory;
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
    };

/** Common observable contract for evaluator options and exploration intentions. */
export abstract class PlanningObjective {
    abstract describe(): PlanningObjectiveDescription;
}
