import { Position } from "./astar.js";
import { IOParcel } from "../types/IOParcel.js";
import { clear } from "node:console";
import agent from "./agent.js";

interface Parcel extends IOParcel {
    lastUpdate: Date;
}

class Beliefs {
    map: string[][];
    target_pos?: Position;
    target_parcel?: string;
    parcels: Map<string, Parcel>;
    crates: Map<string, Position>;
    delivering_cells: Position[];
    pickup_cells: Position[];
    followed_path: Position[];
    movement_duration: number;
    state: number; // 0: looking for a parcel, 1: delivering a parcel

    constructor() {
        this.map = [];
        this.target_pos = undefined;
        this.target_parcel = undefined;
        this.parcels = new Map<string, Parcel>();
        this.crates = new Map<string, Position>();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.followed_path = [];
        this.movement_duration = 0;
        this.state = 0;
    }

    configPhase(config: any): void {
        this.map = config["GAME"]["map"]["tiles"].map((row: any[]) => row.map((cell: any) => cell.toString()));
        this.movement_duration = config["GAME"]["player"]["movement_duration"];

        const rows = this.map.length;
        const cols = this.map[0].length;

        for(let row = 0; row < rows; row++){
            for(let col = 0; col < cols; col++) {
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
    senseParcels(parcels: any[]): void {
        parcels.forEach((parcel: any) => {
            const id = parcel["id"];
            const x = parcel["x"];
            const y = parcel["y"];
            const carriedBy = parcel["carriedBy"];
            const reward = parcel["reward"];
            const lastUpdate = new Date();

            if (!this.parcels.has(id)) {
                this.parcels.set(id, {id, x, y, carriedBy, reward, lastUpdate});
            } else {
                const existingParcel = this.parcels.get(id);

                // If the parcel is no more available, I remove it from the beliefs
                if (existingParcel && existingParcel.reward > (existingParcel.lastUpdate.getTime() - lastUpdate.getTime()) / 1000) {
                    this.parcels.set(id, {id, x, y, carriedBy, reward, lastUpdate});
                } else {
                    this.parcels.delete(id);
                }
            }
        })

        this.clearExpiredParcels();
    }

    // When I deliver parcels, I delete them from the map I am keeping
    // To do that is necessary to remove only the parcels I am carrying
    clearDeliveredParcels(): void {
        this.parcels.forEach((parcel: Parcel, parcel_id: string) =>{
            if (parcel.carriedBy === agent.id) {
                this.parcels.delete(parcel_id);
            }
        });
    }

    /**
     * When a parcel is espired, I know it doesn't exist anymore due to time passing,
     * I delete it since it is useless having the information
     */
    private clearExpiredParcels(): void {
        const timeNow = new Date();

        this.parcels.forEach((parcel: Parcel, _) =>{
            if ((timeNow.getTime() - parcel.lastUpdate.getTime()) / 1000 > parcel.reward) {
                this.parcels.delete(parcel.id);
            }
        });
    }

    // Sense the crates
    senseCrates(crates: any[]): void {
        crates.forEach((crate: any) => {
            const id = crate["id"];
            const position = new Position(crate["x"], crate["y"]);

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

    // Update the target position
    updateTargetPosition(position: Position): void {
        this.target_pos = position;
    }

    // Update the movement duration
    updateMovementDuration(duration: number): void {
        this.movement_duration = duration;
    }

    // Change the state
    changeState(newState: number): void {
        this.state = newState;
    }
}

export default new Beliefs();