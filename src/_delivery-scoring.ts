import { Position } from "./utils/position.js";
import { SCORE_EFFECT_LIFETIME } from "./_score-effect-lifetime.js";

/** Stable identity of a delivery score effect. */
export type DeliveryScoreEffectId = string;

/** The decayed scores of the parcels included in one delivery action. */
export interface DeliveryScoreContext {
    readonly parcelScores: readonly number[];
}

/** Ordering makes composition deterministic when several mission rules apply. */
export enum DELIVERY_SCORE_MODIFIER_PRIORITY {
    PARCEL_FILTER = 0,
    STACK_SIZE = 10,
    MULTIPLICATIVE = 20,
    ADDITIVE = 30,
}

/** Direction in which a modifier can change a non-negative delivery score. */
export enum DELIVERY_SCORE_MODIFIER_IMPACT {
    PENALTY = "penalty",
    NEUTRAL = "neutral",
    BONUS = "bonus",
}

/** Why a delivery cell survived candidate-pool pruning. */
export enum DELIVERY_CANDIDATE_SELECTION_REASON {
    ORIGINAL = "original",
    PENALTY_REPLACEMENT = "penalty-replacement",
    BONUS = "bonus",
}

/** Contract for score transformations attached to delivery missions. */
export abstract class BaseDeliveryScoreModifier {
    abstract readonly priority: DELIVERY_SCORE_MODIFIER_PRIORITY;
    readonly optimizesDeliveryTiming: boolean = false;

    abstract impact(): DELIVERY_SCORE_MODIFIER_IMPACT;

    abstract apply(
        deliveryScore: number,
        context: DeliveryScoreContext,
    ): number;

    /** Optimistic application used only for safe branch upper bounds. */
    optimisticApply(
        deliveryScore: number,
        context: DeliveryScoreContext,
    ): number {
        return Math.max(
            deliveryScore,
            this.apply(deliveryScore, context),
        );
    }

    /** Reward values whose crossing can change this modifier's result. */
    deliveryTimingThresholds(): readonly number[] {
        return [];
    }
}

/** Adds or subtracts a fixed number of points from a delivery. */
export class AdditiveDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    readonly priority = DELIVERY_SCORE_MODIFIER_PRIORITY.ADDITIVE;

    constructor(readonly points: number) {
        super();
    }

    apply(deliveryScore: number, _context: DeliveryScoreContext): number {
        return deliveryScore + this.points;
    }

    impact(): DELIVERY_SCORE_MODIFIER_IMPACT {
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
export class MultiplicativeDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    readonly priority = DELIVERY_SCORE_MODIFIER_PRIORITY.MULTIPLICATIVE;

    constructor(readonly factor: number) {
        super();
    }

    apply(deliveryScore: number, _context: DeliveryScoreContext): number {
        return deliveryScore * this.factor;
    }

    impact(): DELIVERY_SCORE_MODIFIER_IMPACT {
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
export class ExactStackSizeDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    readonly priority = DELIVERY_SCORE_MODIFIER_PRIORITY.STACK_SIZE;

    constructor(
        readonly stackSize: number,
        readonly factor: number,
    ) {
        super();
    }

    apply(
        deliveryScore: number,
        context: DeliveryScoreContext,
    ): number {
        return context.parcelScores.length === this.stackSize
            ? deliveryScore * this.factor
            : deliveryScore;
    }

    override optimisticApply(
        deliveryScore: number,
        _context: DeliveryScoreContext,
    ): number {
        return deliveryScore * Math.max(1, this.factor);
    }

    impact(): DELIVERY_SCORE_MODIFIER_IMPACT {
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
export class ParcelScoreThresholdDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    readonly priority = DELIVERY_SCORE_MODIFIER_PRIORITY.PARCEL_FILTER;
    override readonly optimizesDeliveryTiming: boolean = true;

    constructor(
        readonly threshold: number,
        readonly deliverLower: boolean,
    ) {
        super();
    }

    apply(
        _deliveryScore: number,
        context: DeliveryScoreContext,
    ): number {
        return context.parcelScores.reduce(
            (score: number, parcelScore: number): number =>
                this.isRewarded(parcelScore)
                    ? score + parcelScore
                    : score,
            0,
        );
    }

    override optimisticApply(
        deliveryScore: number,
        _context: DeliveryScoreContext,
    ): number {
        return deliveryScore;
    }

    override deliveryTimingThresholds(): readonly number[] {
        return this.deliverLower ? [this.threshold] : [];
    }

    impact(): DELIVERY_SCORE_MODIFIER_IMPACT {
        return DELIVERY_SCORE_MODIFIER_IMPACT.PENALTY;
    }

    private isRewarded(parcelScore: number): boolean {
        return this.deliverLower
            ? parcelScore <= this.threshold
            : parcelScore >= this.threshold;
    }
}

/** Score transformation that may apply to a delivery candidate. */
export abstract class BaseDeliveryScoreEffect {
    constructor(
        readonly id: DeliveryScoreEffectId,
        readonly modifier: BaseDeliveryScoreModifier,
        readonly lifetime: SCORE_EFFECT_LIFETIME,
    ) { }

    abstract appliesAt(cell: Position): boolean;

    isConsumable(): boolean {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }
}

/** Score transformation caused by dropping at a specific cell. */
export class DeliveryCellEffect extends BaseDeliveryScoreEffect {
    constructor(
        id: DeliveryScoreEffectId,
        readonly cell: Position,
        modifier: BaseDeliveryScoreModifier,
        lifetime: SCORE_EFFECT_LIFETIME = SCORE_EFFECT_LIFETIME.ONE_SHOT,
    ) {
        super(id, modifier, lifetime);
    }

    appliesAt(cell: Position): boolean {
        return this.cell.isEqual(cell);
    }
}

/** Persistent score policy applied at every delivery cell. */
export class GlobalDeliveryScoreEffect extends BaseDeliveryScoreEffect {
    appliesAt(_cell: Position): boolean {
        return true;
    }
}

/** A delivery option enriched with every mission attached to its cell. */
export class DeliveryCandidate {
    constructor(
        readonly cell: Position,
        readonly effects: readonly BaseDeliveryScoreEffect[],
        readonly selectionReason:
            DELIVERY_CANDIDATE_SELECTION_REASON =
                DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL,
    ) { }

    adjustedScore(
        baseDeliveryScore: number,
        parcelScores: readonly number[],
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): number {
        return this.effects.reduce(
            (score: number, effect: BaseDeliveryScoreEffect): number =>
                activeEffectIds.has(effect.id)
                    ? effect.modifier.apply(score, { parcelScores })
                    : score,
            baseDeliveryScore,
        );
    }

    optimisticScore(
        baseDeliveryScore: number,
        parcelScores: readonly number[],
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): number {
        return this.effects.reduce(
            (score: number, effect: BaseDeliveryScoreEffect): number =>
                activeEffectIds.has(effect.id)
                    ? effect.modifier.optimisticApply(
                        score,
                        { parcelScores },
                    )
                    : score,
            baseDeliveryScore,
        );
    }

    shouldOptimizeDeliveryTiming(
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): boolean {
        return this.effects.some(
            (effect: BaseDeliveryScoreEffect): boolean =>
                activeEffectIds.has(effect.id)
                && effect.modifier.optimizesDeliveryTiming,
        );
    }

    deliveryTimingThresholds(
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): readonly number[] {
        return [
            ...new Set(
                this.effects.flatMap(
                    (effect: BaseDeliveryScoreEffect): readonly number[] =>
                        activeEffectIds.has(effect.id)
                            ? effect.modifier.deliveryTimingThresholds()
                            : [],
                ),
            ),
        ];
    }

    consumedEffectIds(
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): readonly DeliveryScoreEffectId[] {
        return this.effects
            .filter(
                (effect: BaseDeliveryScoreEffect): boolean =>
                    activeEffectIds.has(effect.id)
                    && effect.isConsumable(),
            )
            .map(
                (effect: BaseDeliveryScoreEffect): DeliveryScoreEffectId =>
                    effect.id,
            );
    }

    /** Whether a cell-specific penalty applies without a competing local bonus. */
    hasUnopposedCellPenalty(): boolean {
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
    hasCellBonus(): boolean {
        return this.effects.some(
            (effect: BaseDeliveryScoreEffect): boolean =>
                effect instanceof DeliveryCellEffect
                && effect.modifier.impact()
                    === DELIVERY_SCORE_MODIFIER_IMPACT.BONUS,
        );
    }
}

/** Builds deduplicated delivery options from map cells and mission effects. */
export class DeliveryCandidateFactory {
    static make(
        cell: Position,
        effects: readonly BaseDeliveryScoreEffect[],
        selectionReason: DELIVERY_CANDIDATE_SELECTION_REASON =
            DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL,
    ): DeliveryCandidate {
        return new DeliveryCandidate(
            cell,
            effects.filter(
                (effect: BaseDeliveryScoreEffect): boolean =>
                    effect.appliesAt(cell),
            ).sort(
                (
                    first: BaseDeliveryScoreEffect,
                    second: BaseDeliveryScoreEffect,
                ): number => first.modifier.priority - second.modifier.priority,
            ),
            selectionReason,
        );
    }
}
