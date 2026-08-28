import type { IOClockEvent } from "./IOClockEvent.js";

export interface IOConfig {
    CLOCK: number;
    GAME: {
        map: {
            tiles: string[][];
        };
        parcels?: {
            decaying_event?: IOClockEvent;
        };
        player: {
            movement_duration: number;
            observation_distance: number;
        };
    };
}
