import { Position } from "./position.js";

export type Direction = "up" | "down" | "right" | "left";
export type CoordinateOffset = readonly [x: number, y: number];

export type NeighborCoord = {
    coord: Position,
    direction: Direction
};

export class GameMap {
    private gameMap: string[][];
    private cols: number;
    private rows: number;

    constructor(map: string[][]) {
        this.gameMap = map;

        this.rows = this.gameMap.length;
        this.rows > 0
            ? this.cols = this.gameMap[0].length
            : this.cols = 0;
    }

    getTiles(): string[][] {
        return this.gameMap;
    }

    public getRows() {
        return this.rows;
    }

    public getCols() {
        return this.cols;
    }

    public getCellValue(coord: Position): string {
        return this.gameMap[coord.x][coord.y];
    }

    public getNeighborsOf(cellPosition: Position): NeighborCoord[] {
        let neighbors: NeighborCoord[] = [];

        const offsets: CoordinateOffset[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const directions: Direction[] = ["up", "down", "right", "left"];

        for (let index = 0; index < offsets.length; index++) {
            const offset = offsets[index];
            const neighbor = new Position(cellPosition.x + offset[0], cellPosition.y + offset[1]);

            if(this.isValidCell(neighbor)){
                neighbors.push({
                    coord: neighbor,
                    direction: directions[index]
                });
            }
        }

        return neighbors;
    }

    public isValidCoordinates(cell: Position): boolean{
        return (
            cell.x >= 0 && cell.x < this.rows &&
            cell.y >= 0 && cell.y < this.cols
        );
    }

    public isValidCell(cell: Position): boolean {
        if(!this.isValidCoordinates(cell))
            return false;

        if(this.gameMap[cell.x][cell.y] === "0")
            return false;

        return true;
    }

    public signature(): string {
        return JSON.stringify(this.gameMap);
    }
}