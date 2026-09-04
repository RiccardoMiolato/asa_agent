/** A coordinate in the game map. */
export class Position {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    isEqual(other) {
        return this.x === other.x && this.y === other.y;
    }
    distanceTo(other) {
        return Math.abs(this.x - other.x) + Math.abs(this.y - other.y);
    }
    /** Whether this coordinate identifies a discrete map cell. */
    isGridAligned() {
        return Number.isInteger(this.x) && Number.isInteger(this.y);
    }
}
//# sourceMappingURL=position.js.map