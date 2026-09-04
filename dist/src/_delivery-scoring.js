import { SCORE_EFFECT_LIFETIME } from "./_score-effect-lifetime.js";
/** Ordering makes composition deterministic when several mission rules apply. */
export var DELIVERY_SCORE_MODIFIER_PRIORITY;
(function (DELIVERY_SCORE_MODIFIER_PRIORITY) {
    DELIVERY_SCORE_MODIFIER_PRIORITY[DELIVERY_SCORE_MODIFIER_PRIORITY["PARCEL_FILTER"] = 0] = "PARCEL_FILTER";
    DELIVERY_SCORE_MODIFIER_PRIORITY[DELIVERY_SCORE_MODIFIER_PRIORITY["STACK_SIZE"] = 10] = "STACK_SIZE";
    DELIVERY_SCORE_MODIFIER_PRIORITY[DELIVERY_SCORE_MODIFIER_PRIORITY["MULTIPLICATIVE"] = 20] = "MULTIPLICATIVE";
    DELIVERY_SCORE_MODIFIER_PRIORITY[DELIVERY_SCORE_MODIFIER_PRIORITY["ADDITIVE"] = 30] = "ADDITIVE";
})(DELIVERY_SCORE_MODIFIER_PRIORITY || (DELIVERY_SCORE_MODIFIER_PRIORITY = {}));
/** Direction in which a modifier can change a non-negative delivery score. */
export var DELIVERY_SCORE_MODIFIER_IMPACT;
(function (DELIVERY_SCORE_MODIFIER_IMPACT) {
    DELIVERY_SCORE_MODIFIER_IMPACT["PENALTY"] = "penalty";
    DELIVERY_SCORE_MODIFIER_IMPACT["NEUTRAL"] = "neutral";
    DELIVERY_SCORE_MODIFIER_IMPACT["BONUS"] = "bonus";
})(DELIVERY_SCORE_MODIFIER_IMPACT || (DELIVERY_SCORE_MODIFIER_IMPACT = {}));
/** Why a delivery cell survived candidate-pool pruning. */
export var DELIVERY_CANDIDATE_SELECTION_REASON;
(function (DELIVERY_CANDIDATE_SELECTION_REASON) {
    DELIVERY_CANDIDATE_SELECTION_REASON["ORIGINAL"] = "original";
    DELIVERY_CANDIDATE_SELECTION_REASON["PENALTY_REPLACEMENT"] = "penalty-replacement";
    DELIVERY_CANDIDATE_SELECTION_REASON["BONUS"] = "bonus";
})(DELIVERY_CANDIDATE_SELECTION_REASON || (DELIVERY_CANDIDATE_SELECTION_REASON = {}));
/** Whether putting parcels down at a candidate realizes their parcel scores. */
export var DELIVERY_PARCEL_REWARD_ELIGIBILITY;
(function (DELIVERY_PARCEL_REWARD_ELIGIBILITY) {
    DELIVERY_PARCEL_REWARD_ELIGIBILITY["ELIGIBLE"] = "eligible";
    DELIVERY_PARCEL_REWARD_ELIGIBILITY["MISSION_ONLY"] = "mission-only";
})(DELIVERY_PARCEL_REWARD_ELIGIBILITY || (DELIVERY_PARCEL_REWARD_ELIGIBILITY = {}));
/** Contract for score transformations attached to delivery missions. */
export class BaseDeliveryScoreModifier {
    constructor() {
        this.optimizesDeliveryTiming = false;
    }
    /** Optimistic application used only for safe branch upper bounds. */
    optimisticApply(deliveryScore, context) {
        return Math.max(deliveryScore, this.apply(deliveryScore, context));
    }
    /** Reward values whose crossing can change this modifier's result. */
    deliveryTimingThresholds() {
        return [];
    }
}
/** Adds or subtracts a fixed number of points from a delivery. */
export class AdditiveDeliveryScoreModifier extends BaseDeliveryScoreModifier {
    constructor(points) {
        super();
        this.points = points;
        this.priority = DELIVERY_SCORE_MODIFIER_PRIORITY.ADDITIVE;
    }
    apply(deliveryScore, _context) {
        return deliveryScore + this.points;
    }
    impact() {
        if (this.points < 0) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY;
        }
        if (this.points > 0) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.BONUS;
        }
        return DELIVERY_SCORE_MODIFIER_IMPACT.NEUTRAL;
    }
}
/** Multiplies the decayed parcel score delivered at the mission cell. */
export class MultiplicativeDeliveryScoreModifier extends BaseDeliveryScoreModifier {
    constructor(factor) {
        super();
        this.factor = factor;
        this.priority = DELIVERY_SCORE_MODIFIER_PRIORITY.MULTIPLICATIVE;
    }
    apply(deliveryScore, _context) {
        return deliveryScore * this.factor;
    }
    impact() {
        if (this.factor < 1) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY;
        }
        if (this.factor > 1) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.BONUS;
        }
        return DELIVERY_SCORE_MODIFIER_IMPACT.NEUTRAL;
    }
}
/** Applies a multiplier only when a delivery contains exactly the target size. */
export class ExactStackSizeDeliveryScoreModifier extends BaseDeliveryScoreModifier {
    constructor(stackSize, factor) {
        super();
        this.stackSize = stackSize;
        this.factor = factor;
        this.priority = DELIVERY_SCORE_MODIFIER_PRIORITY.STACK_SIZE;
    }
    apply(deliveryScore, context) {
        return context.parcelScores.length === this.stackSize
            ? deliveryScore * this.factor
            : deliveryScore;
    }
    optimisticApply(deliveryScore, _context) {
        return deliveryScore * Math.max(1, this.factor);
    }
    impact() {
        if (this.factor < 1) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY;
        }
        if (this.factor > 1) {
            return DELIVERY_SCORE_MODIFIER_IMPACT.BONUS;
        }
        return DELIVERY_SCORE_MODIFIER_IMPACT.NEUTRAL;
    }
}
/** Gives no points for parcels on the disallowed side of a score threshold. */
export class ParcelScoreThresholdDeliveryScoreModifier extends BaseDeliveryScoreModifier {
    constructor(threshold, deliverLower) {
        super();
        this.threshold = threshold;
        this.deliverLower = deliverLower;
        this.priority = DELIVERY_SCORE_MODIFIER_PRIORITY.PARCEL_FILTER;
        this.optimizesDeliveryTiming = true;
    }
    apply(_deliveryScore, context) {
        return context.parcelScores.reduce((score, parcelScore) => this.isRewarded(parcelScore)
            ? score + parcelScore
            : score, 0);
    }
    optimisticApply(deliveryScore, _context) {
        return deliveryScore;
    }
    deliveryTimingThresholds() {
        return this.deliverLower ? [this.threshold] : [];
    }
    impact() {
        return DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY;
    }
    isRewarded(parcelScore) {
        return this.deliverLower
            ? parcelScore <= this.threshold
            : parcelScore >= this.threshold;
    }
}
/** Score transformation that may apply to a delivery candidate. */
export class BaseDeliveryScoreEffect {
    constructor(id, modifier, lifetime) {
        this.id = id;
        this.modifier = modifier;
        this.lifetime = lifetime;
    }
    isConsumable() {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }
}
/** Score transformation caused by dropping at a specific cell. */
export class DeliveryCellEffect extends BaseDeliveryScoreEffect {
    constructor(id, cell, modifier, lifetime = SCORE_EFFECT_LIFETIME.ONE_SHOT) {
        super(id, modifier, lifetime);
        this.cell = cell;
    }
    appliesAt(cell) {
        return this.cell.isEqual(cell);
    }
}
/** Persistent score policy applied at every delivery cell. */
export class GlobalDeliveryScoreEffect extends BaseDeliveryScoreEffect {
    appliesAt(_cell) {
        return true;
    }
}
/** A delivery option enriched with every mission attached to its cell. */
export class DeliveryCandidate {
    constructor(cell, effects, selectionReason = DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL, parcelRewardEligibility = DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE) {
        this.cell = cell;
        this.effects = effects;
        this.selectionReason = selectionReason;
        this.parcelRewardEligibility = parcelRewardEligibility;
    }
    /** Parcel score realized by dropping at this candidate before modifiers. */
    baseDeliveryScore(parcelScores) {
        return this.rewardedParcelScores(parcelScores).reduce((score, parcelScore) => score + parcelScore, 0);
    }
    adjustedScore(baseDeliveryScore, parcelScores, activeEffectIds) {
        const rewardedParcelScores = this.rewardedParcelScores(parcelScores);
        const eligibleBaseDeliveryScore = this.parcelRewardEligibility
            === DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE
            ? baseDeliveryScore
            : 0;
        return this.effects.reduce((score, effect) => activeEffectIds.has(effect.id)
            ? effect.modifier.apply(score, { parcelScores: rewardedParcelScores })
            : score, eligibleBaseDeliveryScore);
    }
    optimisticScore(baseDeliveryScore, parcelScores, activeEffectIds) {
        const rewardedParcelScores = this.rewardedParcelScores(parcelScores);
        const eligibleBaseDeliveryScore = this.parcelRewardEligibility
            === DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE
            ? baseDeliveryScore
            : 0;
        return this.effects.reduce((score, effect) => activeEffectIds.has(effect.id)
            ? effect.modifier.optimisticApply(score, { parcelScores: rewardedParcelScores })
            : score, eligibleBaseDeliveryScore);
    }
    shouldOptimizeDeliveryTiming(activeEffectIds) {
        return this.effects.some((effect) => activeEffectIds.has(effect.id)
            && effect.modifier.optimizesDeliveryTiming);
    }
    deliveryTimingThresholds(activeEffectIds) {
        return [
            ...new Set(this.effects.flatMap((effect) => activeEffectIds.has(effect.id)
                ? effect.modifier.deliveryTimingThresholds()
                : [])),
        ];
    }
    consumedEffectIds(activeEffectIds) {
        return this.effects
            .filter((effect) => activeEffectIds.has(effect.id)
            && effect.isConsumable())
            .map((effect) => effect.id);
    }
    /** Whether a cell-specific penalty applies without a competing local bonus. */
    hasUnopposedCellPenalty() {
        let hasPenalty = false;
        for (const effect of this.effects) {
            if (!(effect instanceof DeliveryCellEffect)) {
                continue;
            }
            const impact = effect.modifier.impact();
            if (impact === DELIVERY_SCORE_MODIFIER_IMPACT.BONUS) {
                return false;
            }
            if (impact === DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY) {
                hasPenalty = true;
            }
        }
        return hasPenalty;
    }
    /** Whether the delivery cell carries at least one cell-specific bonus. */
    hasCellBonus() {
        return this.effects.some((effect) => effect instanceof DeliveryCellEffect
            && effect.modifier.impact()
                === DELIVERY_SCORE_MODIFIER_IMPACT.BONUS);
    }
    rewardedParcelScores(parcelScores) {
        return this.parcelRewardEligibility
            === DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE
            ? parcelScores
            : [];
    }
}
/** Builds deduplicated delivery options from map cells and mission effects. */
export class DeliveryCandidateFactory {
    static make(cell, effects, selectionReason = DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL, parcelRewardEligibility = DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE) {
        return new DeliveryCandidate(cell, effects.filter((effect) => effect.appliesAt(cell)).sort((first, second) => first.modifier.priority - second.modifier.priority), selectionReason, parcelRewardEligibility);
    }
}
//# sourceMappingURL=_delivery-scoring.js.map