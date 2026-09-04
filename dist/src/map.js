import { Position } from "./position.js";
export class GameMap {
    constructor(map) {
        this.gameMap = map;
        this.rows = this.gameMap.length;
        this.cols = this.gameMap[0].length;
    }
    getRows() {
        return this.rows;
    }
    getCols() {
        return this.cols;
    }
    getCellValue(coord) {
        return this.gameMap[coord.x][coord.y];
    }
    getNeighborsOf(cellPosition) {
        let neighbors = [];
        const offsets = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const directions = ["up", "down", "right", "left"];
        for (let index = 0; index < offsets.length; index++) {
            const offset = offsets[index];
            const neighbor = new Position(cellPosition.x + offset[0], cellPosition.y + offset[1]);
            if (this.isValidCell(neighbor)) {
                neighbors.push({
                    coord: neighbor,
                    direction: directions[index]
                });
            }
        }
        return neighbors;
    }
    isValidCoordinates(cell) {
        return (cell.x >= 0 && cell.x < this.rows &&
            cell.y >= 0 && cell.y < this.cols);
    }
    isValidCell(cell) {
        if (!this.isValidCoordinates(cell))
            return false;
        if (this.gameMap[cell.x][cell.y] === "0")
            return false;
        return true;
    }
}
//# sourceMappingURL=map.js.map