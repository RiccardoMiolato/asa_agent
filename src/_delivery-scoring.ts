import { Position } from "./utils/position.js";

/** Stable identity of a one-shot delivery score effect. */
export type DeliveryScoreEffectId = string;

/** Contract for score transformations attached to delivery missions. */
export abstract class BaseDeliveryScoreModifier {
    abstract apply(baseDeliveryScore: number): number;
}

/** Adds or subtracts a fixed number of points from a delivery. */
export class AdditiveDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    constructor(readonly points: number) {
        super();
    }

    apply(baseDeliveryScore: number): number {
        return baseDeliveryScore + this.points;
    }
}

/** Multiplies the decayed parcel score delivered at the mission cell. */
export class MultiplicativeDeliveryScoreModifier
    extends BaseDeliveryScoreModifier {
    constructor(readonly factor: number) {
        super();
    }

    apply(baseDeliveryScore: number): number {
        return baseDeliveryScore * this.factor;
    }
}

/** One-shot score transformation caused by dropping at a specific cell. */
export class DeliveryCellEffect {
    constructor(
        readonly id: DeliveryScoreEffectId,
        readonly cell: Position,
        readonly modifier: BaseDeliveryScoreModifier,
    ) { }
}

/** A delivery option enriched with every mission attached to its cell. */
export class DeliveryCandidate {
    constructor(
        readonly cell: Position,
        readonly effects: readonly DeliveryCellEffect[],
    ) { }

    adjustedScore(
        baseDeliveryScore: number,
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): number {
        return this.effects.reduce(
            (score: number, effect: DeliveryCellEffect): number =>
                activeEffectIds.has(effect.id)
                    ? effect.modifier.apply(score)
                    : score,
            baseDeliveryScore,
        );
    }

    triggeredEffectIds(
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): readonly DeliveryScoreEffectId[] {
        return this.effects
            .filter(
                (effect: DeliveryCellEffect): boolean =>
                    activeEffectIds.has(effect.id),
            )
            .map(
                (effect: DeliveryCellEffect): DeliveryScoreEffectId =>
                    effect.id,
            );
    }
}

/** Builds deduplicated delivery options from map cells and mission effects. */
export class DeliveryCandidateFactory {
    static make(
        cell: Position,
        effects: readonly DeliveryCellEffect[],
    ): DeliveryCandidate {
        return new DeliveryCandidate(
            cell,
            effects.filter(
                (effect: DeliveryCellEffect): boolean =>
                    effect.cell.isEqual(cell),
            ),
        );
    }
}
