import type { IOConfig } from "../types/IOConfig.js";
import type { IOCrate } from "../types/IOCrate.js";
import type { IOParcel } from "../types/IOParcel.js";
import { Position } from "./position.js";

export interface Parcel extends IOParcel {
    lastUpdate: Date;
}

export class Beliefs {
    private static readonly REWARD_DECAY_INTERVAL = 1_000;

    map: string[][];

    // OBJECT POSITIONS
    parcels: Map<string, Parcel>;
    crates: Map<string, Position>;

    // MAP LOCATIONS
    delivering_cells: Position[];
    pickup_cells: Position[];

    // TIMER FOR MOVES
    movement_duration: number;
    frame_duration: number;
    private lastRewardDecayAt: number | undefined;
    // TODO add player position and id to the believes

    constructor() {
        this.map = [];
        this.parcels = new Map<string, Parcel>();
        this.crates = new Map<string, Position>();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.movement_duration = 0;
        this.frame_duration = 0;
        this.lastRewardDecayAt = undefined;
    }

    /** Revises all dynamic beliefs from one complete sensing snapshot. */
    revise(parcels: IOParcel[], crates: IOCrate[]): void {
        this.senseParcels(parcels);
        this.senseCrates(crates);
    }

    configPhase(config: IOConfig): void {
        this.map = config.GAME.map.tiles;
        this.movement_duration = config.GAME.player.movement_duration;
        this.frame_duration = config.CLOCK;

        const rows = this.map.length;
        const cols = this.map[0].length;

        this.delivering_cells = [];
        this.pickup_cells = [];

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cell = this.map[row][col];
                if (cell == '2') {
                    this.delivering_cells.push(new Position(row, col)); // Map is rotated of 90 degree in the game
                } else if (cell == '1') {
                    this.pickup_cells.push(new Position(row, col)); // Map is rotated of 90 degree in the game
                }
            }
        }
    }


    // Sense the parcels
    senseParcels(parcels: IOParcel[]): void {
        parcels.forEach((parcel: IOParcel) => {
            const { id, x, y, carriedBy, reward } = parcel;
            const lastUpdate = new Date();
            const existingParcel = this.parcels.get(id);

            if (existingParcel && reward < existingParcel.reward) {
                this.lastRewardDecayAt = lastUpdate.getTime();
            }
            this.parcels.set(id, { id, x, y, carriedBy, reward, lastUpdate });
        });

        this.updateParcelRewards();
    }

    /**
     * When I deliver parcels, I delete them from the map I am keeping
     * To do that is necessary to remove only the parcels I am carrying
     */
    clearDeliveredParcels(agentId: string): void {
        this.parcels.forEach((parcel: Parcel, parcel_id: string) => {
            if (parcel.carriedBy === agentId) {
                this.parcels.delete(parcel_id);
            }
        });
    }

    markParcelCarried(parcelId: string, agentId: string): void {
        const parcel = this.parcels.get(parcelId);
        if (parcel && !parcel.carriedBy) {
            parcel.carriedBy = agentId;
        }
    }

    /** Applies complete one-second decay ticks to stale parcel beliefs. */
    updateParcelRewards(): void {
        const timeNow = new Date();

        this.parcels.forEach((parcel: Parcel, id: string) => {
            const elapsedMilliseconds = timeNow.getTime() - parcel.lastUpdate.getTime();
            const elapsedTicks = Math.floor(
                elapsedMilliseconds / Beliefs.REWARD_DECAY_INTERVAL,
            );
            if (elapsedTicks === 0) {
                return;
            }

            parcel.reward = Math.max(0, parcel.reward - elapsedTicks);
            parcel.lastUpdate = new Date(
                parcel.lastUpdate.getTime()
                + elapsedTicks * Beliefs.REWARD_DECAY_INTERVAL,
            );

            if (parcel.reward <= 0) {
                this.parcels.delete(id);
            }
        });
    }

    /** Returns a latency-adjusted delay until the next server reward-decay tick. */
    millisecondsUntilNextRewardDecay(): number | undefined {
        if (this.lastRewardDecayAt === undefined) {
            return undefined;
        }

        const elapsed = Date.now() - this.lastRewardDecayAt;
        const elapsedInCurrentInterval = elapsed % Beliefs.REWARD_DECAY_INTERVAL;
        const delayFromObservedSnapshot = Beliefs.REWARD_DECAY_INTERVAL
            - elapsedInCurrentInterval;
        return Math.max(0, delayFromObservedSnapshot - this.frame_duration);
    }

    // Sense the crates
    senseCrates(crates: IOCrate[]): void {
        crates.forEach((crate: IOCrate) => {
            const id = crate.id;
            const position = new Position(crate.x, crate.y);

            if (!this.hasCrate(id)) {
                this.addCrate(id, position);
            } else {
                // If the crate has been moved then I update the position
                if (!this.crates.get(id)?.isEqual(position)) {
                    this.crates.set(id, position);
                }
            }
        });
    }

    // Add a crate to the map
    private addCrate(id: string, position: Position): void {
        this.crates.set(id, position);
    }

    // Check if a crate exists
    private hasCrate(id: string): boolean {
        return this.crates.has(id);
    }

    // Update the movement duration
    updateMovementDuration(duration: number): void {
        this.movement_duration = duration;
    }

    // Count the number of free parcels
    freeParcelsCount(): number {
        let count = 0;

        this.parcels.forEach(
            parcel => count += parcel.carriedBy ? 0 : 1
        );

        return count;
    }
}
