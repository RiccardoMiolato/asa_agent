import { Position } from "./position.js";

export type Direction = "up" | "down" | "right" | "left";
export type CoordinateOffset = readonly [x: number, y: number];

export class GameMap {
    private gameMap: string[][];
    private cols: number;
    private rows: number;

    constructor(map: string[][]) {
        this.gameMap = map;

        this.rows = this.gameMap.length;
        this.cols = this.gameMap[0].length;
    }

    public getCellValue(coord: Position): string {
        return this.gameMap[coord.x][coord.y];
    }

    public getNeighborsOf(cellPosition: Position): Position[] {
        let neighbors: Position[] = [];

        const offsets: CoordinateOffset[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const directions: Direction[] = ["up", "down", "right", "left"];

        for (let index = 0; index < offsets.length; index++) {
            const offset = offsets[index];
            const neighbor = new Position(cellPosition.x + offset[0], cellPosition.y + offset[1]);

            if(this.isValidCell(neighbor)){
                neighbors.push(neighbor);
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
}