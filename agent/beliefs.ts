import type { IOConfig } from "../types/IOConfig.js";
import type { IOCrate } from "../types/IOCrate.js";
import type { IOParcel } from "../types/IOParcel.js";
import agent from "./agent.js";
import { Position } from "./astar.js";

export interface Parcel extends IOParcel {
    lastUpdate: Date;
}

class Beliefs {
    map: string[][];

    // OBJECT POSITIONS
    parcels: Map<string, Parcel>;
    crates: Map<string, Position>;

    // MAP LOCATIONS
    delivering_cells: Position[];
    pickup_cells: Position[];

    // TIMER FOR MOVES
    movement_duration: number;
    // TODO add player position and id to the believes

    constructor() {
        this.map = [];
        this.parcels = new Map<string, Parcel>();
        this.crates = new Map<string, Position>();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.movement_duration = 0;
    }

    configPhase(config: IOConfig): void {
        this.map = config.GAME.map.tiles.map((row: unknown[]) =>
            row.map((cell: unknown) => String(cell))
        );
        this.movement_duration = config.GAME.player.movement_duration;

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

            if (!this.parcels.has(id)) {
                this.parcels.set(id, { id, x, y, carriedBy, reward, lastUpdate });
            } else {
                const existingParcel = this.parcels.get(id);

                // If the parcel is no more available, I remove it from the beliefs
                if (existingParcel && existingParcel.reward > (existingParcel.lastUpdate.getTime() - lastUpdate.getTime()) / 1000) {
                    this.parcels.set(id, { id, x, y, carriedBy, reward, lastUpdate });
                } else {
                    this.parcels.delete(id);
                }
            }
        })

        this.clearExpiredParcels();
    }

    /**
     * When I deliver parcels, I delete them from the map I am keeping
     * To do that is necessary to remove only the parcels I am carrying
     */
    clearDeliveredParcels(): void {
        this.parcels.forEach((parcel: Parcel, parcel_id: string) => {
            if (parcel.carriedBy === agent.id) {
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

    /**
     * When a parcel is espired, I know it doesn't exist anymore due to time passing,
     * I delete it since it is useless having the information
     */
    private clearExpiredParcels(): void {
        const timeNow = new Date();

        this.parcels.forEach((parcel: Parcel, _) => {
            if ((timeNow.getTime() - parcel.lastUpdate.getTime()) / 1000 > parcel.reward) {
                this.parcels.delete(parcel.id);
            }
        });
    }

    /**
     * Update parcel rewards in order to have them aligned
     * with the real time system the agent is living on
     */
    updateParcelRewards(): void {
        const timeNow = new Date();

        this.parcels.forEach((parcel: Parcel, id: string) => {
            const elapsedSeconds = (timeNow.getTime() - parcel.lastUpdate.getTime()) / 1000;
            parcel.reward = Math.max(0, Math.floor(parcel.reward - elapsedSeconds));
            parcel.lastUpdate = timeNow;

            if (parcel.reward <= 0) {
                this.parcels.delete(id);
            }
        });
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

export default new Beliefs();
