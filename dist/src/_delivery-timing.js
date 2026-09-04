import { RewardDecayEstimator } from "./utils/_reward-decay.js";
/** Selects the highest-scoring delivery time without changing spatial routing. */
export class DeliveryTimingOptimizer {
    static maximizeScore(deliveryCandidate, parcelRewards, earliestDeliveryMilliseconds, rewardDecayInterval, millisecondsUntilNextRewardDecay, activeEffectIds) {
        const consideredWaitMilliseconds = DeliveryTimingOptimizer.candidateWaitMilliseconds(deliveryCandidate, parcelRewards, earliestDeliveryMilliseconds, rewardDecayInterval, millisecondsUntilNextRewardDecay, activeEffectIds);
        let bestDecision;
        for (const waitMilliseconds of consideredWaitMilliseconds) {
            const deliveryElapsedMilliseconds = earliestDeliveryMilliseconds + waitMilliseconds;
            const parcelScores = parcelRewards.map((reward) => RewardDecayEstimator.remainingReward(reward, deliveryElapsedMilliseconds, rewardDecayInterval, millisecondsUntilNextRewardDecay));
            const baseDeliveryScore = deliveryCandidate.baseDeliveryScore(parcelScores);
            const adjustedDeliveryScore = deliveryCandidate.adjustedScore(baseDeliveryScore, parcelScores, activeEffectIds);
            const decision = {
                waitMilliseconds,
                parcelScores,
                baseDeliveryScore,
                adjustedDeliveryScore,
                consideredWaitMilliseconds,
            };
            if (bestDecision === undefined
                || adjustedDeliveryScore > bestDecision.adjustedDeliveryScore
                || adjustedDeliveryScore
                    === bestDecision.adjustedDeliveryScore
                    && waitMilliseconds < bestDecision.waitMilliseconds) {
                bestDecision = decision;
            }
        }
        if (bestDecision === undefined) {
            throw new Error("Delivery timing requires at least one candidate");
        }
        return bestDecision;
    }
    static candidateWaitMilliseconds(deliveryCandidate, parcelRewards, earliestDeliveryMilliseconds, rewardDecayInterval, millisecondsUntilNextRewardDecay, activeEffectIds) {
        const waits = new Set([0]);
        if (rewardDecayInterval === undefined
            || !deliveryCandidate.shouldOptimizeDeliveryTiming(activeEffectIds)) {
            return [...waits];
        }
        for (const threshold of deliveryCandidate.deliveryTimingThresholds(activeEffectIds)) {
            for (const reward of parcelRewards) {
                const crossingMilliseconds = RewardDecayEstimator.elapsedMillisecondsUntilRewardAtMost(reward, threshold, rewardDecayInterval, millisecondsUntilNextRewardDecay);
                if (crossingMilliseconds !== undefined
                    && crossingMilliseconds > earliestDeliveryMilliseconds) {
                    waits.add(crossingMilliseconds - earliestDeliveryMilliseconds);
                }
            }
        }
        return [...waits].sort((first, second) => first - second);
    }
}
//# sourceMappingURL=_delivery-timing.js.map