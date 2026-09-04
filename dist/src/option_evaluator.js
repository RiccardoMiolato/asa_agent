import { DeliverParcelsDesire, PickUpParcelDesire, } from "./desires.js";
import { EarliestDeliveryRewardBranchBoundEstimator, } from "./_option-pruning.js";
import { RewardDecayEstimator } from "./_reward-decay.js";
export { BaseOptionBranchBoundEstimator, ConservativeRewardBranchBoundEstimator, EarliestDeliveryRewardBranchBoundEstimator, } from "./_option-pruning.js";
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
        const result = this.evaluateRec(context, context.agentPosition, generation.rootDesires, generation.carriedParcelIds, 0, rootNodeId, 0, nodes, edges, generation.deliveryCellCandidates);
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
    evaluateRec(context, agentPosition, desires, carriedParcelIds, elapsedMilliseconds, nodeId, depth, nodes, edges, deliveryCellCandidates) {
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
            const assessment = this.assessTraversability(context, agentPosition, desire.targetCell);
            if (assessment.distance === undefined) {
                edges.push({
                    order: currentOptionOrder,
                    sourceNodeId: nodeId,
                    targetNodeId: undefined,
                    optionIdentity: desire.identity(),
                    optionType: desire.type,
                    parcelId: desire.parcelId,
                    targetPosition: desire.targetCell,
                    traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                    estimatedDistance: undefined,
                    estimatedArrivalMilliseconds: undefined,
                    realizedDeliveryScore: 0,
                    estimatedActionScore: undefined,
                    remainingParcelScore: undefined,
                    branchUpperBound: undefined,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.UNREACHABLE,
                });
                continue;
            }
            const newElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(assessment.distance, 1, context.movementDuration, context.frameDuration);
            const remainingDesires = new Set(desires);
            remainingDesires.delete(desire);
            let newCarriedIds = [...carriedParcelIds];
            let scoreForThisOption = 0;
            if (desire instanceof PickUpParcelDesire) {
                newCarriedIds.push(desire.parcelId);
                const hasDeliveryDesire = [...remainingDesires].some((candidate) => candidate instanceof DeliverParcelsDesire);
                if (!hasDeliveryDesire) {
                    for (const deliveryCell of deliveryCellCandidates) {
                        remainingDesires.add(new DeliverParcelsDesire(deliveryCell));
                    }
                }
            }
            else {
                scoreForThisOption = this.computeDeliveryScore(context, carriedParcelIds, newElapsedMilliseconds);
                newCarriedIds = [];
                for (const candidate of remainingDesires) {
                    if (candidate instanceof DeliverParcelsDesire) {
                        remainingDesires.delete(candidate);
                    }
                }
            }
            const targetNodeId = `${nodeId}/${desire.identity()}`;
            const remainingParcelIds = [...remainingDesires]
                .filter((candidate) => candidate instanceof PickUpParcelDesire)
                .map((candidate) => candidate.parcelId);
            const bound = this.branchBoundEstimator.estimate(context, {
                actionType: desire.type,
                positionAfterAction: desire.targetCell,
                carriedParcelIdsAfterAction: newCarriedIds,
                remainingParcelIds,
                elapsedMillisecondsAfterAction: newElapsedMilliseconds,
                realizedDeliveryScore: scoreForThisOption,
                deliveryCellCandidates,
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
                    traversability: assessment.traversability,
                    estimatedDistance: assessment.distance,
                    estimatedArrivalMilliseconds: newElapsedMilliseconds,
                    realizedDeliveryScore: scoreForThisOption,
                    estimatedActionScore: bound.estimatedActionScore,
                    remainingParcelScore: bound.remainingParcelScore,
                    branchUpperBound: bound.totalScore,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.PRUNED_BY_BOUND,
                });
                continue;
            }
            const nextResult = this.evaluateRec(context, desire.targetCell, remainingDesires, newCarriedIds, newElapsedMilliseconds, targetNodeId, depth + 1, nodes, edges, deliveryCellCandidates);
            const totalScore = scoreForThisOption + nextResult.totalScore;
            const candidateResult = {
                bestSequence: [desire, ...nextResult.bestSequence],
                totalScore,
                completionMilliseconds: nextResult.completionMilliseconds,
            };
            const evaluatedCandidate = {
                order: currentOptionOrder,
                desire,
                targetNodeId,
                traversability: assessment.traversability,
                distance: assessment.distance,
                arrivalMilliseconds: newElapsedMilliseconds,
                realizedDeliveryScore: scoreForThisOption,
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
                traversability: candidate.traversability,
                estimatedDistance: candidate.distance,
                estimatedArrivalMilliseconds: candidate.arrivalMilliseconds,
                realizedDeliveryScore: candidate.realizedDeliveryScore,
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
    shouldPrune(bound, earliestCompletionMilliseconds, incumbent) {
        if (bound.totalScore !== incumbent.totalScore) {
            return bound.totalScore < incumbent.totalScore;
        }
        return earliestCompletionMilliseconds
            >= incumbent.completionMilliseconds;
    }
    /** Separates guaranteed A* reachability from optimistic crate-relaxed reachability. */
    assessTraversability(context, startingPosition, targetPosition) {
        const directDistance = context.pathfinder.pathLength(context.gameMap, startingPosition, targetPosition, context.crates);
        if (directDistance !== undefined) {
            return {
                traversability: OPTION_TRAVERSABILITY.DIRECT,
                distance: directDistance,
            };
        }
        if (context.crates.size === 0) {
            return {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
            };
        }
        const crateRelaxedDistance = context.pathfinder.pathLength(context.gameMap, startingPosition, targetPosition, new Map());
        return crateRelaxedDistance === undefined
            ? {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
            }
            : {
                traversability: OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING,
                distance: crateRelaxedDistance,
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
    computeDeliveryScore(context, carriedParcelIds, elapsedMilliseconds) {
        let deliveryScore = 0;
        for (const parcelId of carriedParcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (!parcel) {
                continue;
            }
            deliveryScore += RewardDecayEstimator.remainingReward(parcel.reward, elapsedMilliseconds, context.rewardDecayInterval, context.millisecondsUntilNextRewardDecay);
        }
        return deliveryScore;
    }
}
//# sourceMappingURL=option_evaluator.js.map