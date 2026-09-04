import { AdditiveDeliveryScoreModifier, DeliveryCellEffect, ExactStackSizeDeliveryScoreModifier, GlobalDeliveryScoreEffect, MultiplicativeDeliveryScoreModifier, ParcelScoreThresholdDeliveryScoreModifier, } from "../_delivery-scoring.js";
import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";
import { CellScoreEffect } from "../utils/_cell-score-effects.js";
/** Stable participants used by a two-agent rendezvous assignment. */
export var RENDEZVOUS_PARTICIPANT;
(function (RENDEZVOUS_PARTICIPANT) {
    RENDEZVOUS_PARTICIPANT["LLM_AGENT"] = "llm-agent";
    RENDEZVOUS_PARTICIPANT["BDI_AGENT"] = "bdi-agent";
})(RENDEZVOUS_PARTICIPANT || (RENDEZVOUS_PARTICIPANT = {}));
/** Base contract for every mission retained by the mission handler. */
export class Mission {
    constructor(id, missionLevel, lifetime) {
        this.id = id;
        this.missionLevel = missionLevel;
        this.lifetime = lifetime;
    }
    getId() {
        return this.id;
    }
    getLevel() {
        return this.missionLevel;
    }
    getLifetime() {
        return this.lifetime;
    }
    isConsumable() {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }
}
/** Shared state for one-shot and persistent missions tied to a map cell. */
export class BaseCellMission extends Mission {
    constructor(id, level, lifetime, missionType, bonusType, bonusValue, mapCell) {
        super(id, level, lifetime);
        this.missionType = missionType;
        this.bonusType = bonusType;
        this.bonusValue = bonusValue;
        this.mapCell = mapCell;
    }
    getType() {
        return this.missionType;
    }
    getBonusType() {
        return this.bonusType;
    }
    getBonusValue() {
        return this.bonusType === "penalty"
            ? -this.bonusValue
            : this.bonusValue;
    }
    getRelatedCell() {
        return this.mapCell;
    }
    describe() {
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
    constructor(id, level, bonusType, bonusValue, cell, lifetime = SCORE_EFFECT_LIFETIME.ONE_SHOT) {
        super(id, level, lifetime, "move-to", bonusType, bonusValue, cell);
    }
    toScoreEffect() {
        return new CellScoreEffect(this.getId(), this.getRelatedCell(), this.getBonusValue(), this.getLifetime());
    }
}
/** Mission that transforms the reward delivered at one specific cell. */
export class DeliveryCellMission extends BaseCellMission {
    constructor(id, level, bonusType, bonusValue, cell, lifetime = SCORE_EFFECT_LIFETIME.ONE_SHOT) {
        super(id, level, lifetime, "drop-at", bonusType, bonusValue, cell);
    }
    toScoreEffect() {
        const modifier = this.getBonusType() === "multiplier"
            ? new MultiplicativeDeliveryScoreModifier(this.getBonusValue())
            : new AdditiveDeliveryScoreModifier(this.getBonusValue());
        return new DeliveryCellEffect(this.getId(), this.getRelatedCell(), modifier, this.getLifetime());
    }
}
/** Persistent penalty for entering a particular map cell. */
export class AvoidCellMission extends BaseCellMission {
    constructor(id, penalty, cell) {
        super(id, 2, SCORE_EFFECT_LIFETIME.PERSISTENT, "avoid", "penalty", Math.abs(penalty), cell);
    }
    toScoreEffect() {
        return new CellScoreEffect(this.getId(), this.getRelatedCell(), this.getBonusValue(), this.getLifetime());
    }
}
/** Persistent conditional multiplier for deliveries of an exact stack size. */
export class StackSizeMission extends Mission {
    constructor(id, stackSize, multiplier) {
        super(id, 2, SCORE_EFFECT_LIFETIME.PERSISTENT);
        this.stackSize = stackSize;
        this.multiplier = multiplier;
    }
    getType() {
        return "stack-size";
    }
    toScoreEffect() {
        return new GlobalDeliveryScoreEffect(this.getId(), new ExactStackSizeDeliveryScoreModifier(this.stackSize, this.multiplier), this.getLifetime());
    }
    describe() {
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
    constructor(id, threshold, deliverLower) {
        super(id, 2, SCORE_EFFECT_LIFETIME.PERSISTENT);
        this.threshold = threshold;
        this.deliverLower = deliverLower;
    }
    getType() {
        return "parcel-score";
    }
    toScoreEffect() {
        return new GlobalDeliveryScoreEffect(this.getId(), new ParcelScoreThresholdDeliveryScoreModifier(this.threshold, this.deliverLower), this.getLifetime());
    }
    describe() {
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
/** Joint level-3 objective whose assignments await peer negotiation. */
export class RendezvousMission extends Mission {
    constructor(id, center, maximumDistance, reward, llmAgentTarget, bdiAgentTarget) {
        super(id, 3, SCORE_EFFECT_LIFETIME.ONE_SHOT);
        this.center = center;
        this.maximumDistance = maximumDistance;
        this.reward = reward;
        this.assignments = [
            {
                participant: RENDEZVOUS_PARTICIPANT.LLM_AGENT,
                target: llmAgentTarget,
            },
            {
                participant: RENDEZVOUS_PARTICIPANT.BDI_AGENT,
                target: bdiAgentTarget,
            },
        ];
    }
    getType() {
        return "rendezvous";
    }
    assignmentFor(participant) {
        const assignment = this.assignments.find((candidate) => candidate.participant === participant);
        if (!assignment) {
            throw new Error(`Missing rendezvous assignment for ${participant}`);
        }
        return assignment;
    }
    describe() {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.getType(),
            center: this.center,
            maximumDistance: this.maximumDistance,
            reward: this.reward,
            assignments: this.assignments,
        };
    }
}
/** Joint level-3 formation whose peer resolves its own closest valid cell. */
export class GridFormationMission extends Mission {
    constructor(id, reward, llmAgentObjective, bdiAgentObjective) {
        super(id, 3, SCORE_EFFECT_LIFETIME.ONE_SHOT);
        this.reward = reward;
        this.llmAgentObjective = llmAgentObjective;
        this.bdiAgentObjective = bdiAgentObjective;
    }
    getType() {
        return "grid-formation";
    }
    describe() {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.getType(),
            reward: this.reward,
            objectives: [
                {
                    participant: RENDEZVOUS_PARTICIPANT.LLM_AGENT,
                    objective: this.llmAgentObjective.describe(),
                },
                {
                    participant: RENDEZVOUS_PARTICIPANT.BDI_AGENT,
                    objective: this.bdiAgentObjective.describe(),
                },
            ],
        };
    }
}
/** Joint level-3 objective completed by transferring one parcel between peers. */
export class ParcelHandoffMission extends Mission {
    constructor(id, reward) {
        super(id, 3, SCORE_EFFECT_LIFETIME.ONE_SHOT);
        this.reward = reward;
        if (!Number.isFinite(reward) || reward <= 0) {
            throw new RangeError("Parcel handoff reward must be positive");
        }
    }
    getType() {
        return "parcel-handoff";
    }
    describe() {
        return {
            id: this.getId(),
            level: this.getLevel(),
            lifetime: this.getLifetime(),
            type: this.getType(),
            reward: this.reward,
        };
    }
}
//# sourceMappingURL=mission.js.map