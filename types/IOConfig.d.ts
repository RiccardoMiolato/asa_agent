export interface IOConfig {
    CLOCK: number;
    GAME: {
        map: {
            tiles: string[][];
        };
        player: {
            movement_duration: number;
        };
    };
}
