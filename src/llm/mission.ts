import {
    AdditiveDeliveryScoreModifier,
    DeliveryCellEffect,
    ExactStackSizeDeliveryScoreModifier,
    GlobalDeliveryScoreEffect,
    MultiplicativeDeliveryScoreModifier,
    ParcelScoreThresholdDeliveryScoreModifier,
    type BaseDeliveryScoreEffect,
} from "../_delivery-scoring.js";
import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";
import { CellScoreEffect } from "../utils/_cell-score-effects.js";
import { Position } from "../utils/position.js";

export type MissionId = string;
export type MissionLevel = 1 | 2 | 3;
export type CellMissionType = "move-to" | "pick-up" | "drop-at" | "avoid";
export type MissionType = CellMissionType | "stack-size" | "parcel-score";
export type BonusType = "reward" | "penalty" | "multiplier";

interface BaseMissionDescription {
    readonly id: MissionId;
    readonly level: MissionLevel;
    readonly lifetime: SCORE_EFFECT_LIFETIME;
}

/** Structured description of a mission tied to one map cell. */
export interface CellMissionDescription extends BaseMissionDescription {
    readonly type: CellMissionType;
    readonly bonusType: BonusType;
    readonly bonusValue: number;
    readonly target: Position;
}

/** Structured description of an exact-stack delivery rule. */
export interface StackSizeMissionDescription extends BaseMissionDescription {
    readonly type: "stack-size";
    readonly stackSize: number;
    readonly multiplier: number;
}

/** Structured description of a parcel-score delivery rule. */
export interface ParcelScoreMissionDescription extends BaseMissionDescription {
    readonly type: "parcel-score";
    readonly threshold: number;
    readonly deliverLower: boolean;
}

/** Immutable mission details exposed to logging and read-only observers. */
export type MissionDescription =
    | CellMissionDescription
    | StackSizeMissionDescription
    | ParcelScoreMissionDescription;

/** Base contract for every mission retained by the mission handler. */
export abstract class Mission {
    constructor(
        private readonly id: MissionId,
        private readonly missionLevel: MissionLevel,
        private readonly lifetime: SCORE_EFFECT_LIFETIME,
    ) { }

    getId(): MissionId {
        return this.id;
    }

    getLevel(): MissionLevel {
        return this.missionLevel;
    }

    getLifetime(): SCORE_EFFECT_LIFETIME {
        return this.lifetime;
    }

    isConsumable(): boolean {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }

    abstract getType(): MissionType;
    abstract describe(): MissionDescription;
}

/** Shared state for one-shot and persistent missions tied to a map cell. */
export abstract class BaseCellMission extends Mission {
    constructor(
        id: MissionId,
        level: MissionLevel,
        lifetime: SCORE_EFFECT_LIFETIME,
        private readonly missionType: CellMissionType,
        private readonly bonusType: BonusType,
        private readonly bonusValue: number,
        private readonly mapCell: Position,
    ) {
        super(id, level, lifetime);
    }

    getType(): CellMissionType {
        return this.missionType;
    }

    getBonusType(): BonusType {
        return this.bonusType;
    }

    getBonusValue(): number {
        return this.bonusType === "penalty"
            ? -this.bonusValue
            : this.bonusValue;
    }

    getRelatedCell(): Position {
        return this.mapCell;
    }

    describe(): CellMissionDescription {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.missionType,
            bonusType: this.bonusType,
            bonusValue: this.bonusValue,
            target: this.mapCell,
        };
    }
}

/** Mission that changes score when its map cell is entered. */
export class MoveToMission extends BaseCellMission {
    constructor(
        id: MissionId,
        level: MissionLevel,
        bonusType: BonusType,
        bonusValue: number,
        cell: Position,
        lifetime: SCORE_EFFECT_LIFETIME = SCORE_EFFECT_LIFETIME.ONE_SHOT,
    ) {
        super(
            id,
            level,
            lifetime,
            "move-to",
            bonusType,
            bonusValue,
            cell,
        );
    }

    toScoreEffect(): CellScoreEffect {
        return new CellScoreEffect(
            this.getId(),
            this.getRelatedCell(),
            this.getBonusValue(),
            this.getLifetime(),
        );
    }
}

/** Mission that transforms the reward delivered at one specific cell. */
export class DeliveryCellMission extends BaseCellMission {
    constructor(
        id: MissionId,
        level: MissionLevel,
        bonusType: BonusType,
        bonusValue: number,
        cell: Position,
        lifetime: SCORE_EFFECT_LIFETIME = SCORE_EFFECT_LIFETIME.ONE_SHOT,
    ) {
        super(
            id,
            level,
            lifetime,
            "drop-at",
            bonusType,
            bonusValue,
            cell,
        );
    }

    toScoreEffect(): DeliveryCellEffect {
        const modifier = this.getBonusType() === "multiplier"
            ? new MultiplicativeDeliveryScoreModifier(this.getBonusValue())
            : new AdditiveDeliveryScoreModifier(this.getBonusValue());
        return new DeliveryCellEffect(
            this.getId(),
            this.getRelatedCell(),
            modifier,
            this.getLifetime(),
        );
    }
}

/** Persistent penalty for entering a particular map cell. */
export class AvoidCellMission extends BaseCellMission {
    constructor(
        id: MissionId,
        penalty: number,
        cell: Position,
    ) {
        super(
            id,
            2,
            SCORE_EFFECT_LIFETIME.PERSISTENT,
            "avoid",
            "penalty",
            Math.abs(penalty),
            cell,
        );
    }

    toScoreEffect(): CellScoreEffect {
        return new CellScoreEffect(
            this.getId(),
            this.getRelatedCell(),
            this.getBonusValue(),
            this.getLifetime(),
        );
    }
}

/** Persistent conditional multiplier for deliveries of an exact stack size. */
export class StackSizeMission extends Mission {
    constructor(
        id: MissionId,
        readonly stackSize: number,
        readonly multiplier: number,
    ) {
        super(id, 2, SCORE_EFFECT_LIFETIME.PERSISTENT);
    }

    getType(): "stack-size" {
        return "stack-size";
    }

    toScoreEffect(): BaseDeliveryScoreEffect {
        return new GlobalDeliveryScoreEffect(
            this.getId(),
            new ExactStackSizeDeliveryScoreModifier(
                this.stackSize,
                this.multiplier,
            ),
            this.getLifetime(),
        );
    }

    describe(): StackSizeMissionDescription {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.getType(),
            stackSize: this.stackSize,
            multiplier: this.multiplier,
        };
    }
}

/** Persistent rule that zeroes rewards outside a parcel-score threshold. */
export class ParcelScoreMission extends Mission {
    constructor(
        id: MissionId,
        readonly threshold: number,
        readonly deliverLower: boolean,
    ) {
        super(id, 2, SCORE_EFFECT_LIFETIME.PERSISTENT);
    }

    getType(): "parcel-score" {
        return "parcel-score";
    }

    toScoreEffect(): BaseDeliveryScoreEffect {
        return new GlobalDeliveryScoreEffect(
            this.getId(),
            new ParcelScoreThresholdDeliveryScoreModifier(
                this.threshold,
                this.deliverLower,
            ),
            this.getLifetime(),
        );
    }

    describe(): ParcelScoreMissionDescription {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.getType(),
            threshold: this.threshold,
            deliverLower: this.deliverLower,
        };
    }
}
