import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";
/** A score change caused by entering a map cell. */
export class CellScoreEffect {
    constructor(id, cell, score, lifetime = SCORE_EFFECT_LIFETIME.ONE_SHOT, 
    /** Whether only its dedicated visit option may trigger this effect. */
    requiresExplicitVisit = false) {
        this.id = id;
        this.cell = cell;
        this.score = score;
        this.lifetime = lifetime;
        this.requiresExplicitVisit = requiresExplicitVisit;
    }
    isConsumable() {
        return this.lifetime === SCORE_EFFECT_LIFETIME.ONE_SHOT;
    }
}
/** Operations shared by route search and branch evaluation. */
export class CellScoreEffectEvaluator {
    /** Returns the effects first triggered by entering a position. */
    static triggeredAt(position, effects, previouslyTriggeredIds) {
        return effects.filter((effect) => !previouslyTriggeredIds.has(effect.id)
            && effect.cell.isEqual(position));
    }
    /** Adds the signed score changes of the supplied effects. */
    static totalScore(effects) {
        return effects.reduce((score, effect) => score + effect.score, 0);
    }
    /** Stable representation used by path-length caches. */
    static signature(effects) {
        return effects
            .map((effect) => `${effect.id}@${effect.cell.x},${effect.cell.y}:${effect.score}:${effect.lifetime}:${effect.requiresExplicitVisit}`)
            .sort()
            .join("|");
    }
}
//# sourceMappingURL=_cell-score-effects.js.map