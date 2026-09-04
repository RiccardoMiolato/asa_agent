import { OptimisticPathLengthEstimator } from "./_path-estimation.js";
import { DESIRE_TYPE } from "./bdi/desires.js";
import { RewardDecayEstimator } from "./utils/_reward-decay.js";
import { Position } from "./utils/position.js";
/** Contract for upper-bound strategies used by option search. */
export class BaseOptionBranchBoundEstimator {
}
/** Shared scoring architecture for reward-based branch bounds. */
class BaseRewardBranchBoundEstimator extends BaseOptionBranchBoundEstimator {
    estimate(context, candidate) {
        const estimatedActionScore = candidate.actionType === DESIRE_TYPE.DELIVER
            ? candidate.realizedDeliveryScore
            : this.estimatePickedParcelDeliveryScore(context, candidate);
        const remainingParcelScore = this.estimateRemainingParcelScore(context, candidate);
        return {
            estimatedActionScore,
            remainingParcelScore,
            totalScore: candidate.realizedCellScore
                + estimatedActionScore
                + remainingParcelScore
                + candidate.remainingPositiveCellScore,
        };
    }
    scoreParcelsAt(context, parcelIds, elapsedMilliseconds) {
        return this.parcelScoresAt(context, parcelIds, elapsedMilliseconds).reduce((score, parcelScore) => score + parcelScore, 0);
    }
    parcelScoresAt(context, parcelIds, elapsedMilliseconds) {
        const parcelScores = [];
        for (const parcelId of parcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (parcel === undefined) {
                continue;
            }
            parcelScores.push(Math.max(0, RewardDecayEstimator.remainingReward(parcel.reward, elapsedMilliseconds, context.rewardDecayInterval, context.millisecondsUntilNextRewardDecay)));
        }
        return parcelScores;
    }
    estimatePickedParcelDeliveryScore(context, candidate) {
        let bestScore = 0;
        for (const deliveryCandidate of candidate.deliveryCellCandidates) {
            const distance = OptimisticPathLengthEstimator.estimate(context, candidate.positionAfterAction, deliveryCandidate.cell);
            if (distance === undefined) {
                continue;
            }
            const deliveryElapsedMilliseconds = candidate.elapsedMillisecondsAfterAction
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(distance, 1, context.movementDuration, context.frameDuration);
            const parcelScores = this.parcelScoresAt(context, candidate.carriedParcelIdsAfterAction, deliveryElapsedMilliseconds);
            const baseDeliveryScore = deliveryCandidate.baseDeliveryScore(parcelScores);
            bestScore = Math.max(bestScore, deliveryCandidate.optimisticScore(baseDeliveryScore, parcelScores, candidate.remainingDeliveryEffectIds));
        }
        return bestScore;
    }
}
/**
 * Bounds a branch using a path-aware action score and immediate remaining
 * parcel rewards. Each parcel contributes to exactly one component.
 */
export class ConservativeRewardBranchBoundEstimator extends BaseRewardBranchBoundEstimator {
    estimateRemainingParcelScore(context, candidate) {
        let score = 0;
        for (const parcelId of candidate.remainingParcelIds) {
            const parcelScores = this.parcelScoresAt(context, [parcelId], candidate.elapsedMillisecondsAfterAction);
            let bestScore = 0;
            for (const deliveryCandidate of candidate.deliveryCellCandidates) {
                const baseDeliveryScore = deliveryCandidate.baseDeliveryScore(parcelScores);
                bestScore = Math.max(bestScore, deliveryCandidate.optimisticScore(baseDeliveryScore, parcelScores, candidate.remainingDeliveryEffectIds));
            }
            score += bestScore;
        }
        return score;
    }
}
/**
 * Bounds every uncollected parcel at its independently earliest delivery.
 *
 * Independent routes can overlap impossibly, so their sum remains optimistic,
 * while unavoidable pickup, travel, and delivery time make the bound tighter
 * than valuing every parcel immediately after the candidate action.
 */
export class EarliestDeliveryRewardBranchBoundEstimator extends BaseRewardBranchBoundEstimator {
    estimateRemainingParcelScore(context, candidate) {
        let score = 0;
        for (const parcelId of candidate.remainingParcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (parcel === undefined) {
                continue;
            }
            const pickupPosition = new Position(parcel.x, parcel.y);
            const pickupDistance = OptimisticPathLengthEstimator.estimate(context, candidate.positionAfterAction, pickupPosition);
            if (pickupDistance === undefined) {
                continue;
            }
            const bestDeliveryScore = this.estimateBestDeliveryScore(context, parcel.reward, pickupPosition, pickupDistance, candidate.elapsedMillisecondsAfterAction, candidate.deliveryCellCandidates, candidate.remainingDeliveryEffectIds);
            score += bestDeliveryScore;
        }
        return score;
    }
    estimateBestDeliveryScore(context, parcelReward, pickupPosition, pickupDistance, elapsedMilliseconds, deliveryCellCandidates, activeEffectIds) {
        let bestScore = 0;
        for (const deliveryCandidate of deliveryCellCandidates) {
            const distance = OptimisticPathLengthEstimator.estimate(context, pickupPosition, deliveryCandidate.cell);
            if (distance === undefined) {
                continue;
            }
            const deliveryElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(pickupDistance + distance, 2, context.movementDuration, context.frameDuration);
            const parcelScore = RewardDecayEstimator.remainingReward(parcelReward, deliveryElapsedMilliseconds, context.rewardDecayInterval, context.millisecondsUntilNextRewardDecay);
            const baseDeliveryScore = deliveryCandidate.baseDeliveryScore([parcelScore]);
            bestScore = Math.max(bestScore, deliveryCandidate.optimisticScore(baseDeliveryScore, [parcelScore], activeEffectIds));
        }
        return bestScore;
    }
}
//# sourceMappingURL=_option-pruning.js.map