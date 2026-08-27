/** A coordinate in the game map. */
export class Position {
    constructor(
        public x: number,
        public y: number,
    ) { }

    isEqual(other: Position): boolean {
        return this.x === other.x && this.y === other.y;
    }

    distanceTo(other: Position): number {
        return Math.abs(this.x - other.x) + Math.abs(this.y - other.y);
    }
}
