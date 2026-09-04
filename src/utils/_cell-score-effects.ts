import { Position } from "./position.js";
import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";

/** Stable identity of a score effect attached to a map cell. */
export type CellScoreEffectId = string;

/** A score change caused by entering a map cell. */
export class CellScoreEffect {
    constructor(
        readonly id: CellScoreEffectId,
        readonly cell: Position,
        readonly score: number,
        readonly lifetime: SCORE_EFFECT_LIFETIME =
            SCORE_EFFECT_LIFETIME.ONE_SHOT,
        /** Whether only its dedicated visit option may trigger this effect. */
        readonly requiresExplicitVisit: boolean = false,
    ) { }

    isConsumable(): boolean {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }
}

/** Operations shared by route search and branch evaluation. */
export class CellScoreEffectEvaluator {
    /** Returns the effects first triggered by entering a position. */
    static triggeredAt(
        position: Position,
        effects: readonly CellScoreEffect[],
        previouslyTriggeredIds: ReadonlySet<CellScoreEffectId>,
    ): readonly CellScoreEffect[] {
        return effects.filter(
            (effect: CellScoreEffect): boolean =>
                !previouslyTriggeredIds.has(effect.id)
                && effect.cell.isEqual(position),
        );
    }

    /** Adds the signed score changes of the supplied effects. */
    static totalScore(effects: readonly CellScoreEffect[]): number {
        return effects.reduce(
            (score: number, effect: CellScoreEffect): number =>
                score + effect.score,
            0,
        );
    }

    /** Stable representation used by path-length caches. */
    static signature(effects: readonly CellScoreEffect[]): string {
        return effects
            .map(
                (effect: CellScoreEffect): string =>
                    `${effect.id}@${effect.cell.x},${effect.cell.y}:${effect.score}:${effect.lifetime}:${effect.requiresExplicitVisit}`,
            )
            .sort()
            .join("|");
    }
}
