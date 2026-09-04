import {
    type DeliveryCandidate,
    type DeliveryScoreEffectId,
} from "./_delivery-scoring.js";
import { RewardDecayEstimator } from "./utils/_reward-decay.js";

/** Result of optimizing one delivery candidate over relevant decay times. */
export interface DeliveryTimingDecision {
    readonly waitMilliseconds: number;
    readonly parcelScores: readonly number[];
    readonly baseDeliveryScore: number;
    readonly adjustedDeliveryScore: number;
    readonly consideredWaitMilliseconds: readonly number[];
}

/** Selects the highest-scoring delivery time without changing spatial routing. */
export class DeliveryTimingOptimizer {
    static maximizeScore(
        deliveryCandidate: DeliveryCandidate,
        parcelRewards: readonly number[],
        earliestDeliveryMilliseconds: number,
        rewardDecayInterval: number | undefined,
        millisecondsUntilNextRewardDecay: number | undefined,
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): DeliveryTimingDecision {
        const consideredWaitMilliseconds =
            DeliveryTimingOptimizer.candidateWaitMilliseconds(
                deliveryCandidate,
                parcelRewards,
                earliestDeliveryMilliseconds,
                rewardDecayInterval,
                millisecondsUntilNextRewardDecay,
                activeEffectIds,
            );
        let bestDecision: DeliveryTimingDecision | undefined;

        for (const waitMilliseconds of consideredWaitMilliseconds) {
            const deliveryElapsedMilliseconds =
                earliestDeliveryMilliseconds + waitMilliseconds;
            const parcelScores = parcelRewards.map(
                (reward: number): number =>
                    RewardDecayEstimator.remainingReward(
                        reward,
                        deliveryElapsedMilliseconds,
                        rewardDecayInterval,
                        millisecondsUntilNextRewardDecay,
                    ),
            );
            const baseDeliveryScore = deliveryCandidate.baseDeliveryScore(
                parcelScores,
            );
            const adjustedDeliveryScore = deliveryCandidate.adjustedScore(
                baseDeliveryScore,
                parcelScores,
                activeEffectIds,
            );
            const decision: DeliveryTimingDecision = {
                waitMilliseconds,
                parcelScores,
                baseDeliveryScore,
                adjustedDeliveryScore,
                consideredWaitMilliseconds,
            };
            if (
                bestDecision === undefined
                || adjustedDeliveryScore > bestDecision.adjustedDeliveryScore
                || adjustedDeliveryScore
                    === bestDecision.adjustedDeliveryScore
                    && waitMilliseconds < bestDecision.waitMilliseconds
            ) {
                bestDecision = decision;
            }
        }

        if (bestDecision === undefined) {
            throw new Error("Delivery timing requires at least one candidate");
        }
        return bestDecision;
    }

    private static candidateWaitMilliseconds(
        deliveryCandidate: DeliveryCandidate,
        parcelRewards: readonly number[],
        earliestDeliveryMilliseconds: number,
        rewardDecayInterval: number | undefined,
        millisecondsUntilNextRewardDecay: number | undefined,
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): readonly number[] {
        const waits = new Set<number>([0]);
        if (
            rewardDecayInterval === undefined
            || !deliveryCandidate.shouldOptimizeDeliveryTiming(activeEffectIds)
        ) {
            return [...waits];
        }

        for (
            const threshold
            of deliveryCandidate.deliveryTimingThresholds(activeEffectIds)
        ) {
            for (const reward of parcelRewards) {
                const crossingMilliseconds =
                    RewardDecayEstimator.elapsedMillisecondsUntilRewardAtMost(
                        reward,
                        threshold,
                        rewardDecayInterval,
                        millisecondsUntilNextRewardDecay,
                    );
                if (
                    crossingMilliseconds !== undefined
                    && crossingMilliseconds > earliestDeliveryMilliseconds
                ) {
                    waits.add(
                        crossingMilliseconds - earliestDeliveryMilliseconds,
                    );
                }
            }
        }
        return [...waits].sort(
            (first: number, second: number): number => first - second,
        );
    }
}
