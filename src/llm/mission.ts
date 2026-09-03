import { Position } from "../utils/position.js";

export type MissionId = string;
export type MissionLevel = 1 | 2 | 3;
export type MissionType = "move-to" | "pick-up" | "drop-at" | "avoid";
export type BonusType = "reward" | "penalty" | "multiplier";

export class Mission {
    constructor(
        private readonly id: MissionId,
        private readonly missionLevel: MissionLevel,
        private readonly missionType: MissionType,
        private readonly bonusType: BonusType,
        private readonly bonusValue: number,
        private readonly mapCell: Position
    ) {

    }

    getId(): MissionId {
        return this.id;
    }

    getLevel(): MissionLevel {
        return this.missionLevel;
    }

    getType(): MissionType {
        return this.missionType;
    }

    getBonusType(): BonusType {
        return this.bonusType;
    }

    getBonusValue(): number {
        if(this.bonusType === "penalty")
            return -this.bonusValue;

        return this.bonusValue;
    }

    getRelatedCell(): Position {
        return this.mapCell;
    }

    log(): void {
        console.log(`${this.missionType} at (${this.mapCell.x},${this.mapCell.y}) for +/- ${this.bonusValue} pts/multiplier`);
    }
}
