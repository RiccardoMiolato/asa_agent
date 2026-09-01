import { DESIRE_TYPE } from "./desires.js";
import { OptimisticPathLengthEstimator } from "./_path-estimation.js";
import type { PlanningContext } from "./planning.js";
import { Position } from "./position.js";
import { RewardDecayEstimator } from "./_reward-decay.js";

/** Candidate state inspected before the evaluator expands a branch. */
export interface OptionBranchCandidate {
    readonly actionType: DESIRE_TYPE;
    readonly positionAfterAction: Position;
    readonly carriedParcelIdsAfterAction: readonly string[];
    readonly remainingParcelIds: readonly string[];
    readonly elapsedMillisecondsAfterAction: number;
    readonly realizedDeliveryScore: number;
    readonly deliveryCellCandidates: readonly Position[];
}

/** Explainable optimistic score assigned to one candidate branch. */
export interface OptionBranchBound {
    /** Path-aware delivery estimate for parcels associated with the action. */
    readonly estimatedActionScore: number;
    /** Immediate optimistic value of parcels still available for pickup. */
    readonly remainingParcelScore: number;
    readonly totalScore: number;
}

/** Contract for upper-bound strategies used by option search. */
export abstract class BaseOptionBranchBoundEstimator {
    abstract estimate(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): OptionBranchBound;
}

/**
 * Bounds a branch using a path-aware action score and immediate remaining
 * parcel rewards. Each parcel contributes to exactly one component.
 */
export class ConservativeRewardBranchBoundEstimator
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
            totalScore: estimatedActionScore + remainingParcelScore,
        };
    }

    private estimatePickedParcelDeliveryScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number {
        let bestScore = 0;
        for (const deliveryCell of candidate.deliveryCellCandidates) {
            const distance = OptimisticPathLengthEstimator.estimate(
                context,
                candidate.positionAfterAction,
                deliveryCell,
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
            bestScore = Math.max(
                bestScore,
                this.scoreParcelsAt(
                    context,
                    candidate.carriedParcelIdsAfterAction,
                    deliveryElapsedMilliseconds,
                ),
            );
        }
        return bestScore;
    }

    private estimateRemainingParcelScore(
        context: PlanningContext,
        candidate: OptionBranchCandidate,
    ): number {
        return this.scoreParcelsAt(
            context,
            candidate.remainingParcelIds,
            candidate.elapsedMillisecondsAfterAction,
        );
    }

    private scoreParcelsAt(
        context: PlanningContext,
        parcelIds: readonly string[],
        elapsedMilliseconds: number,
    ): number {
        let score = 0;
        for (const parcelId of parcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (parcel === undefined) {
                continue;
            }

            score += Math.max(
                0,
                RewardDecayEstimator.remainingReward(
                    parcel.reward,
                    elapsedMilliseconds,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                ),
            );
        }
        return score;
    }
}
