import { EarliestDeliveryRewardBranchBoundEstimator } from "../_option-pruning.js";
import { DELIVERY_CANDIDATE_SELECTION_REASON, } from "../_delivery-scoring.js";
import { DeliveryTimingOptimizer } from "../_delivery-timing.js";
import { RewardDecayEstimator } from "../utils/_reward-decay.js";
import { CellScoreEffectEvaluator, } from "../utils/_cell-score-effects.js";
import { DeliverParcelsDesire, PickUpParcelDesire, VisitCellDesire, } from "./desires.js";
export { BaseOptionBranchBoundEstimator, ConservativeRewardBranchBoundEstimator, EarliestDeliveryRewardBranchBoundEstimator } from "../_option-pruning.js";
/** How the evaluator believes an option edge can be crossed. */
export var OPTION_TRAVERSABILITY;
(function (OPTION_TRAVERSABILITY) {
    OPTION_TRAVERSABILITY["DIRECT"] = "direct";
    OPTION_TRAVERSABILITY["REQUIRES_CRATE_PLANNING"] = "requires-crate-planning";
    OPTION_TRAVERSABILITY["UNREACHABLE"] = "unreachable";
})(OPTION_TRAVERSABILITY || (OPTION_TRAVERSABILITY = {}));
/** Why a reachable branch was or was not retained in the best sequence. */
export var OPTION_BRANCH_DECISION;
(function (OPTION_BRANCH_DECISION) {
    OPTION_BRANCH_DECISION["SELECTED"] = "selected";
    OPTION_BRANCH_DECISION["LOWER_VALUE"] = "lower-value";
    OPTION_BRANCH_DECISION["PRUNED_BY_BOUND"] = "pruned-by-bound";
    OPTION_BRANCH_DECISION["UNREACHABLE"] = "unreachable";
})(OPTION_BRANCH_DECISION || (OPTION_BRANCH_DECISION = {}));
export class OptionEvaluator {
    constructor(desireGenerator, branchBoundEstimator = new EarliestDeliveryRewardBranchBoundEstimator()) {
        this.desireGenerator = desireGenerator;
        this.branchBoundEstimator = branchBoundEstimator;
    }
    evaluate(context, excludedRootOptionIdentities) {
        return this.evaluateWithGraph(context, excludedRootOptionIdentities).bestSequence;
    }
    /** Evaluates options while retaining every visited node and considered edge. */
    evaluateWithGraph(context, excludedRootOptionIdentities) {
        const generation = this.desireGenerator.generate(context, excludedRootOptionIdentities);
        const nodes = [];
        const edges = [];
        const rootNodeId = "root";
        const result = this.evaluateRec(context, context.agentPosition, generation.rootDesires, generation.carriedParcelIds, 0, rootNodeId, 0, nodes, edges, generation.deliveryCellCandidates, context.cellScoreEffects, new Set(context.deliveryScoreEffects.map((effect) => effect.id)));
        return {
            bestSequence: result.bestSequence,
            graph: {
                rootNodeId,
                nodes,
                edges,
                excludedRootOptionIdentities: [...(excludedRootOptionIdentities ?? [])],
                bestScore: result.totalScore,
                estimatedCompletionMilliseconds: result.completionMilliseconds,
            },
        };
    }
    evaluateRec(context, agentPosition, desires, carriedParcelIds, elapsedMilliseconds, nodeId, depth, nodes, edges, deliveryCellCandidates, remainingCellScoreEffects, remainingDeliveryEffectIds) {
        let bestResult = {
            bestSequence: [],
            totalScore: 0,
            completionMilliseconds: elapsedMilliseconds,
        };
        let selectedCandidate;
        const evaluatedCandidates = [];
        let optionOrder = 0;
        for (const desire of desires) {
            const currentOptionOrder = optionOrder;
            optionOrder += 1;
            const assessment = this.assessTraversability(context, agentPosition, desire, remainingCellScoreEffects);
            if (assessment.distance === undefined) {
                edges.push({
                    order: currentOptionOrder,
                    sourceNodeId: nodeId,
                    targetNodeId: undefined,
                    optionIdentity: desire.identity(),
                    optionType: desire.type,
                    parcelId: desire.parcelId,
                    targetPosition: desire.targetCell,
                    isPenaltyReplacement: this.isPenaltyReplacement(desire),
                    traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                    estimatedDistance: undefined,
                    estimatedArrivalMilliseconds: undefined,
                    deliveryWaitMilliseconds: 0,
                    realizedDeliveryScore: 0,
                    realizedDeliveryMissionScore: 0,
                    realizedCellScore: 0,
                    estimatedActionScore: undefined,
                    remainingParcelScore: undefined,
                    branchUpperBound: undefined,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.UNREACHABLE,
                });
                continue;
            }
            let newElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(assessment.distance, 1, context.movementDuration, context.frameDuration);
            let evaluatedDesire = desire;
            let deliveryWaitMilliseconds = 0;
            const remainingDesires = new Set(desires);
            remainingDesires.delete(desire);
            const triggeredCellEffectIds = new Set(assessment.triggeredCellEffectIds);
            for (const candidate of remainingDesires) {
                if (candidate instanceof VisitCellDesire
                    && triggeredCellEffectIds.has(candidate.missionId)) {
                    remainingDesires.delete(candidate);
                }
            }
            const nextCellScoreEffects = remainingCellScoreEffects.filter((effect) => !triggeredCellEffectIds.has(effect.id)
                || !effect.isConsumable());
            let newCarriedIds = [...carriedParcelIds];
            let deliveryScoreForThisOption = 0;
            let deliveryMissionScoreForThisOption = 0;
            const nextDeliveryEffectIds = new Set(remainingDeliveryEffectIds);
            if (desire instanceof PickUpParcelDesire) {
                newCarriedIds.push(desire.parcelId);
                const hasDeliveryDesire = [...remainingDesires].some((candidate) => candidate instanceof DeliverParcelsDesire);
                if (!hasDeliveryDesire) {
                    for (const deliveryCandidate of deliveryCellCandidates) {
                        remainingDesires.add(new DeliverParcelsDesire(deliveryCandidate));
                    }
                }
            }
            else if (desire instanceof DeliverParcelsDesire) {
                const parcelRewards = this.carriedParcelRewards(context, carriedParcelIds);
                const timing = DeliveryTimingOptimizer.maximizeScore(desire.deliveryCandidate, parcelRewards, newElapsedMilliseconds, context.rewardDecayInterval, context.millisecondsUntilNextRewardDecay, remainingDeliveryEffectIds);
                deliveryWaitMilliseconds = timing.waitMilliseconds;
                newElapsedMilliseconds += deliveryWaitMilliseconds;
                evaluatedDesire = desire.scheduledAfter(deliveryWaitMilliseconds);
                deliveryScoreForThisOption = timing.adjustedDeliveryScore;
                deliveryMissionScoreForThisOption =
                    deliveryScoreForThisOption - timing.baseDeliveryScore;
                for (const effectId of desire.deliveryCandidate.consumedEffectIds(remainingDeliveryEffectIds)) {
                    nextDeliveryEffectIds.delete(effectId);
                }
                newCarriedIds = [];
                for (const candidate of remainingDesires) {
                    if (candidate instanceof DeliverParcelsDesire) {
                        remainingDesires.delete(candidate);
                    }
                }
            }
            const targetNodeId = `${nodeId}/${evaluatedDesire.identity()}`;
            const remainingParcelIds = [...remainingDesires]
                .filter((candidate) => candidate instanceof PickUpParcelDesire)
                .map((candidate) => candidate.parcelId);
            const bound = this.branchBoundEstimator.estimate(context, {
                actionType: desire.type,
                positionAfterAction: desire.targetCell,
                carriedParcelIdsAfterAction: newCarriedIds,
                remainingParcelIds,
                elapsedMillisecondsAfterAction: newElapsedMilliseconds,
                realizedDeliveryScore: deliveryScoreForThisOption,
                realizedCellScore: assessment.cellScore,
                remainingPositiveCellScore: nextCellScoreEffects.reduce((score, effect) => effect.score > 0 ? score + effect.score : score, 0),
                deliveryCellCandidates,
                remainingDeliveryEffectIds: nextDeliveryEffectIds,
            });
            if (this.shouldPrune(bound, newElapsedMilliseconds, bestResult)) {
                edges.push({
                    order: currentOptionOrder,
                    sourceNodeId: nodeId,
                    targetNodeId: undefined,
                    optionIdentity: desire.identity(),
                    optionType: desire.type,
                    parcelId: desire.parcelId,
                    targetPosition: desire.targetCell,
                    isPenaltyReplacement: this.isPenaltyReplacement(desire),
                    traversability: assessment.traversability,
                    estimatedDistance: assessment.distance,
                    estimatedArrivalMilliseconds: newElapsedMilliseconds,
                    deliveryWaitMilliseconds,
                    realizedDeliveryScore: deliveryScoreForThisOption,
                    realizedDeliveryMissionScore: deliveryMissionScoreForThisOption,
                    realizedCellScore: assessment.cellScore,
                    estimatedActionScore: bound.estimatedActionScore,
                    remainingParcelScore: bound.remainingParcelScore,
                    branchUpperBound: bound.totalScore,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.PRUNED_BY_BOUND,
                });
                continue;
            }
            const nextResult = this.evaluateRec(context, desire.targetCell, remainingDesires, newCarriedIds, newElapsedMilliseconds, targetNodeId, depth + 1, nodes, edges, deliveryCellCandidates, nextCellScoreEffects, nextDeliveryEffectIds);
            const totalScore = assessment.cellScore
                + deliveryScoreForThisOption
                + nextResult.totalScore;
            const candidateResult = {
                bestSequence: [evaluatedDesire, ...nextResult.bestSequence],
                totalScore,
                completionMilliseconds: nextResult.completionMilliseconds,
            };
            const evaluatedCandidate = {
                order: currentOptionOrder,
                desire: evaluatedDesire,
                targetNodeId,
                traversability: assessment.traversability,
                distance: assessment.distance,
                arrivalMilliseconds: newElapsedMilliseconds,
                deliveryWaitMilliseconds,
                realizedDeliveryScore: deliveryScoreForThisOption,
                realizedDeliveryMissionScore: deliveryMissionScoreForThisOption,
                realizedCellScore: assessment.cellScore,
                bound,
                result: candidateResult,
            };
            evaluatedCandidates.push(evaluatedCandidate);
            if (this.isBetterResult(candidateResult, bestResult)) {
                bestResult = candidateResult;
                selectedCandidate = evaluatedCandidate;
            }
        }
        for (const candidate of evaluatedCandidates) {
            edges.push({
                order: candidate.order,
                sourceNodeId: nodeId,
                targetNodeId: candidate.targetNodeId,
                optionIdentity: candidate.desire.identity(),
                optionType: candidate.desire.type,
                parcelId: candidate.desire.parcelId,
                targetPosition: candidate.desire.targetCell,
                isPenaltyReplacement: this.isPenaltyReplacement(candidate.desire),
                traversability: candidate.traversability,
                estimatedDistance: candidate.distance,
                estimatedArrivalMilliseconds: candidate.arrivalMilliseconds,
                deliveryWaitMilliseconds: candidate.deliveryWaitMilliseconds,
                realizedDeliveryScore: candidate.realizedDeliveryScore,
                realizedDeliveryMissionScore: candidate.realizedDeliveryMissionScore,
                realizedCellScore: candidate.realizedCellScore,
                estimatedActionScore: candidate.bound.estimatedActionScore,
                remainingParcelScore: candidate.bound.remainingParcelScore,
                branchUpperBound: candidate.bound.totalScore,
                branchScore: candidate.result.totalScore,
                decision: candidate === selectedCandidate
                    ? OPTION_BRANCH_DECISION.SELECTED
                    : OPTION_BRANCH_DECISION.LOWER_VALUE,
            });
        }
        nodes.push({
            id: nodeId,
            depth,
            position: agentPosition,
            carriedParcelIds: [...carriedParcelIds],
            elapsedMilliseconds,
            selectedOptionIdentity: selectedCandidate?.desire.identity(),
        });
        return bestResult;
    }
    isPenaltyReplacement(desire) {
        return desire instanceof DeliverParcelsDesire
            && desire.deliveryCandidate.selectionReason
                === DELIVERY_CANDIDATE_SELECTION_REASON.PENALTY_REPLACEMENT;
    }
    shouldPrune(bound, earliestCompletionMilliseconds, incumbent) {
        if (bound.totalScore !== incumbent.totalScore) {
            return bound.totalScore < incumbent.totalScore;
        }
        return earliestCompletionMilliseconds
            >= incumbent.completionMilliseconds;
    }
    /** Separates guaranteed A* reachability from optimistic crate-relaxed reachability. */
    assessTraversability(context, startingPosition, desire, cellScoreEffects) {
        const targetPosition = desire.targetCell;
        const applicableEffects = cellScoreEffects.filter((effect) => !effect.requiresExplicitVisit
            || desire instanceof VisitCellDesire
                && desire.missionId === effect.id);
        const directPath = context.pathfinder.findMovementPath(context.gameMap, startingPosition, targetPosition, context.crates, applicableEffects);
        if (directPath.positions.length > 0) {
            const alreadyAtTargetEffects = startingPosition.isEqual(targetPosition)
                ? CellScoreEffectEvaluator.triggeredAt(startingPosition, applicableEffects.filter((effect) => effect.requiresExplicitVisit), new Set())
                : [];
            return {
                traversability: OPTION_TRAVERSABILITY.DIRECT,
                distance: directPath.movementSteps,
                cellScore: directPath.cellScore
                    + CellScoreEffectEvaluator.totalScore(alreadyAtTargetEffects),
                triggeredCellEffectIds: [
                    ...directPath.triggeredCellEffectIds,
                    ...alreadyAtTargetEffects.map((effect) => effect.id),
                ],
            };
        }
        if (context.crates.size === 0) {
            return {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
                cellScore: 0,
                triggeredCellEffectIds: [],
            };
        }
        const crateRelaxedPath = context.pathfinder.findMovementPath(context.gameMap, startingPosition, targetPosition, new Map(), applicableEffects);
        return crateRelaxedPath.positions.length === 0
            ? {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
                cellScore: 0,
                triggeredCellEffectIds: [],
            }
            : {
                traversability: OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING,
                distance: crateRelaxedPath.movementSteps,
                cellScore: crateRelaxedPath.cellScore,
                triggeredCellEffectIds: crateRelaxedPath.triggeredCellEffectIds,
            };
    }
    /** Maximizes reward first, then avoids work that earns no additional reward. */
    isBetterResult(candidate, currentBest) {
        if (candidate.totalScore !== currentBest.totalScore) {
            return candidate.totalScore > currentBest.totalScore;
        }
        return candidate.completionMilliseconds
            < currentBest.completionMilliseconds;
    }
    carriedParcelRewards(context, carriedParcelIds) {
        const parcelRewards = [];
        for (const parcelId of carriedParcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (!parcel) {
                continue;
            }
            parcelRewards.push(parcel.reward);
        }
        return parcelRewards;
    }
}
//# sourceMappingURL=option_evaluator.js.map