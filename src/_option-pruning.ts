import { OptimisticPathLengthEstimator } from "./_path-estimation.js";
import type {
    DeliveryCandidate,
    DeliveryScoreEffectId,
} from "./_delivery-scoring.js";
import { DESIRE_TYPE } from "./bdi/desires.js";
import type { PlanningContext } from "./planning.js";
import { RewardDecayEstimator } from "./utils/_reward-decay.js";
import { Position } from "./utils/position.js";

/** Candidate state inspected before the evaluator expands a branch. */
export interface OptionBranchCandidate {
    readonly actionType: DESIRE_TYPE;
    readonly positionAfterAction: Position;
    readonly carriedParcelIdsAfterAction: readonly string[];
    readonly remainingParcelIds: readonly string[];
    readonly elapsedMillisecondsAfterAction: number;
    readonly realizedDeliveryScore: number;
    readonly realizedCellScore: number;
    readonly remainingPositiveCellScore: number;
    readonly deliveryCellCandidates: readonly DeliveryCandidate[];
    readonly remainingDeliveryEffectIds:
        ReadonlySet<DeliveryScoreEffectId>;
}

/** Explainable optimistic score assigned to one candidate branch. */
export interface OptionBranchBound {
    /** Path-aware delivery estimate for parcels associated with the action. */
    readonly estimatedActionScore: number;
    /** Optimistic value of parcels still available for pickup. */
    readonly remainingParcelScore: number;
    /** Optimistic branch score, including remaining positive cell effects. */
    readonly totalScore: number;
}

/** Contract for upper-bound strategies used by option search. */
export abstract class BaseOptionBranchBoundEstimator {
    abstract estimate(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): OptionBranchBound;
}

/** Shared scoring architecture for reward-based branch bounds. */
abstract class BaseRewardBranchBoundEstimator
    extends BaseOptionBranchBoundEstimator {
    override estimate(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): OptionBranchBound {
        const estimatedActionScore = candidate.actionType === DESIRE_TYPE.DELIVER
            ? candidate.realizedDeliveryScore
            : this.estimatePickedParcelDeliveryScore(context, candidate);
        const remainingParcelScore = this.estimateRemainingParcelScore(
            context,
            candidate,
        );

        return {
            estimatedActionScore,
            remainingParcelScore,
            totalScore: candidate.realizedCellScore
                + estimatedActionScore
                + remainingParcelScore
                + candidate.remainingPositiveCellScore,
        };
    }

    protected abstract estimateRemainingParcelScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number;

    protected scoreParcelsAt(
        context: PlanningContext,
        parcelIds: readonly string[],
        elapsedMilliseconds: number,
    ): number {
        return this.parcelScoresAt(
            context,
            parcelIds,
            elapsedMilliseconds,
        ).reduce(
            (score: number, parcelScore: number): number =>
                score + parcelScore,
            0,
        );
    }

    protected parcelScoresAt(
        context: PlanningContext,
        parcelIds: readonly string[],
        elapsedMilliseconds: number,
    ): readonly number[] {
        const parcelScores: number[] = [];
        for (const parcelId of parcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (parcel === undefined) {
                continue;
            }

            parcelScores.push(Math.max(
                0,
                RewardDecayEstimator.remainingReward(
                    parcel.reward,
                    elapsedMilliseconds,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                ),
            ));
        }
        return parcelScores;
    }

    private estimatePickedParcelDeliveryScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number {
        let bestScore = 0;
        for (const deliveryCandidate of candidate.deliveryCellCandidates) {
            const distance = OptimisticPathLengthEstimator.estimate(
                context,
                candidate.positionAfterAction,
                deliveryCandidate.cell,
            );
            if (distance === undefined) {
                continue;
            }

            const deliveryElapsedMilliseconds =
                candidate.elapsedMillisecondsAfterAction
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(
                    distance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                );
            const parcelScores = this.parcelScoresAt(
                context,
                candidate.carriedParcelIdsAfterAction,
                deliveryElapsedMilliseconds,
            );
            const baseDeliveryScore = parcelScores.reduce(
                (score: number, parcelScore: number): number =>
                    score + parcelScore,
                0,
            );
            bestScore = Math.max(
                bestScore,
                baseDeliveryScore,
                deliveryCandidate.optimisticScore(
                    baseDeliveryScore,
                    parcelScores,
                    candidate.remainingDeliveryEffectIds,
                ),
            );
        }
        return bestScore;
    }
}

/**
 * Bounds a branch using a path-aware action score and immediate remaining
 * parcel rewards. Each parcel contributes to exactly one component.
 */
export class ConservativeRewardBranchBoundEstimator
    extends BaseRewardBranchBoundEstimator {
    protected override estimateRemainingParcelScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number {
        let score = 0;
        for (const parcelId of candidate.remainingParcelIds) {
            const parcelScores = this.parcelScoresAt(
                context,
                [parcelId],
                candidate.elapsedMillisecondsAfterAction,
            );
            const baseDeliveryScore = parcelScores[0] ?? 0;
            let bestScore = baseDeliveryScore;
            for (const deliveryCandidate of candidate.deliveryCellCandidates) {
                bestScore = Math.max(
                    bestScore,
                    deliveryCandidate.optimisticScore(
                        baseDeliveryScore,
                        parcelScores,
                        candidate.remainingDeliveryEffectIds,
                    ),
                );
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
export class EarliestDeliveryRewardBranchBoundEstimator
    extends BaseRewardBranchBoundEstimator {
    protected override estimateRemainingParcelScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number {
        let score = 0;
        for (const parcelId of candidate.remainingParcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (parcel === undefined) {
                continue;
            }

            const pickupPosition = new Position(parcel.x, parcel.y);
            const pickupDistance = OptimisticPathLengthEstimator.estimate(
                context,
                candidate.positionAfterAction,
                pickupPosition,
            );
            if (pickupDistance === undefined) {
                continue;
            }

            const bestDeliveryScore = this.estimateBestDeliveryScore(
                context,
                parcel.reward,
                pickupPosition,
                pickupDistance,
                candidate.elapsedMillisecondsAfterAction,
                candidate.deliveryCellCandidates,
                candidate.remainingDeliveryEffectIds,
            );
            score += bestDeliveryScore;
        }
        return score;
    }

    private estimateBestDeliveryScore(
        context: PlanningContext,
        parcelReward: number,
        pickupPosition: Position,
        pickupDistance: number,
        elapsedMilliseconds: number,
        deliveryCellCandidates: readonly DeliveryCandidate[],
        activeEffectIds: ReadonlySet<DeliveryScoreEffectId>,
    ): number {
        let bestScore = 0;
        for (const deliveryCandidate of deliveryCellCandidates) {
            const distance = OptimisticPathLengthEstimator.estimate(
                context,
                pickupPosition,
                deliveryCandidate.cell,
            );
            if (distance === undefined) {
                continue;
            }

            const deliveryElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(
                    pickupDistance + distance,
                    2,
                    context.movementDuration,
                    context.frameDuration,
                );
            const baseDeliveryScore = RewardDecayEstimator.remainingReward(
                parcelReward,
                deliveryElapsedMilliseconds,
                context.rewardDecayInterval,
                context.millisecondsUntilNextRewardDecay,
            );
            bestScore = Math.max(
                bestScore,
                baseDeliveryScore,
                deliveryCandidate.optimisticScore(
                    baseDeliveryScore,
                    [baseDeliveryScore],
                    activeEffectIds,
                ),
            );
        }
        return bestScore;
    }
}
