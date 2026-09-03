import { BaseOptionBranchBoundEstimator, EarliestDeliveryRewardBranchBoundEstimator, OptionBranchBound } from "../_option-pruning.js";
import { PlanningContext } from "../planning.js";
import { RewardDecayEstimator } from "../utils/_reward-decay.js";
import type {
    CellScoreEffect,
    CellScoreEffectId,
} from "../utils/_cell-score-effects.js";
import { Position } from "../utils/position.js";
import {
    DeliverParcelsDesire,
    Desire,
    DesireGenerator,
    PickUpParcelDesire,
    VisitCellDesire,
    type DESIRE_TYPE,
} from "./desires.js";

export {
    BaseOptionBranchBoundEstimator,
    ConservativeRewardBranchBoundEstimator,
    EarliestDeliveryRewardBranchBoundEstimator,
    type OptionBranchBound,
    type OptionBranchCandidate
} from "../_option-pruning.js";

/** How the evaluator believes an option edge can be crossed. */
export enum OPTION_TRAVERSABILITY {
    DIRECT = "direct",
    REQUIRES_CRATE_PLANNING = "requires-crate-planning",
    UNREACHABLE = "unreachable",
}

/** Why a reachable branch was or was not retained in the best sequence. */
export enum OPTION_BRANCH_DECISION {
    SELECTED = "selected",
    LOWER_VALUE = "lower-value",
    PRUNED_BY_BOUND = "pruned-by-bound",
    UNREACHABLE = "unreachable",
}

/** One world state visited by the recursive option search. */
export interface OptionEvaluationNode {
    readonly id: string;
    readonly depth: number;
    readonly position: Position;
    readonly carriedParcelIds: readonly string[];
    readonly elapsedMilliseconds: number;
    /** Undefined means that stopping at this node beat every outgoing edge. */
    readonly selectedOptionIdentity: string | undefined;
}

/** One pickup, delivery, or mission-visit edge considered from a node. */
export interface OptionEvaluationEdge {
    readonly order: number;
    readonly sourceNodeId: string;
    readonly targetNodeId: string | undefined;
    readonly optionIdentity: string;
    readonly optionType: DESIRE_TYPE;
    readonly parcelId: string | undefined;
    readonly targetPosition: Position;
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly estimatedDistance: number | undefined;
    readonly estimatedArrivalMilliseconds: number | undefined;
    /** Reward realized on this edge; nonzero only when the action is a drop. */
    readonly realizedDeliveryScore: number;
    /** One-shot move-to rewards and penalties triggered along this edge. */
    readonly realizedCellScore: number;
    /** Path-aware delivery estimate for parcels associated with this action. */
    readonly estimatedActionScore: number | undefined;
    /** Optimistic value of parcels still available for pickup. */
    readonly remainingParcelScore: number | undefined;
    readonly branchUpperBound: number | undefined;
    readonly branchScore: number | undefined;
    readonly decision: OPTION_BRANCH_DECISION;
}

/** Explainable graph produced by one complete evaluator pass. */
export interface OptionEvaluationGraph {
    readonly rootNodeId: string;
    readonly nodes: readonly OptionEvaluationNode[];
    readonly edges: readonly OptionEvaluationEdge[];
    readonly excludedRootOptionIdentities: readonly string[];
    readonly bestScore: number;
    readonly estimatedCompletionMilliseconds: number;
}

/** Winning sequence plus the graph that explains how it was selected. */
export interface OptionEvaluation {
    readonly bestSequence: Desire[];
    readonly graph: OptionEvaluationGraph;
}

interface EvaluationResult {
    readonly bestSequence: Desire[];
    readonly totalScore: number;
    readonly completionMilliseconds: number;
}

interface TraversabilityAssessment {
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly distance: number | undefined;
    readonly cellScore: number;
    readonly triggeredCellEffectIds: readonly CellScoreEffectId[];
}

interface EvaluatedCandidate {
    readonly order: number;
    readonly desire: Desire;
    readonly targetNodeId: string;
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly distance: number;
    readonly arrivalMilliseconds: number;
    readonly realizedDeliveryScore: number;
    readonly realizedCellScore: number;
    readonly bound: OptionBranchBound;
    readonly result: EvaluationResult;
}

export class OptionEvaluator {
    constructor(
        private readonly desireGenerator: DesireGenerator,
        private readonly branchBoundEstimator:
            BaseOptionBranchBoundEstimator =
                new EarliestDeliveryRewardBranchBoundEstimator(),
    ) { }

    evaluate(
        context: PlanningContext,
        excludedRootOptionIdentities?: ReadonlySet<string>,
    ): Desire[] {
        return this.evaluateWithGraph(
            context,
            excludedRootOptionIdentities,
        ).bestSequence;
    }

    /** Evaluates options while retaining every visited node and considered edge. */
    evaluateWithGraph(
        context: PlanningContext,
        excludedRootOptionIdentities?: ReadonlySet<string>,
    ): OptionEvaluation {
        const generation = this.desireGenerator.generate(
            context,
            excludedRootOptionIdentities,
        );

        const nodes: OptionEvaluationNode[] = [];
        const edges: OptionEvaluationEdge[] = [];
        const rootNodeId = "root";
        const result = this.evaluateRec(
            context,
            context.agentPosition,
            generation.rootDesires,
            generation.carriedParcelIds,
            0,
            rootNodeId,
            0,
            nodes,
            edges,
            generation.deliveryCellCandidates,
            context.cellScoreEffects,
        );

        return {
            bestSequence: result.bestSequence,
            graph: {
                rootNodeId,
                nodes,
                edges,
                excludedRootOptionIdentities:
                    [...(excludedRootOptionIdentities ?? [])],
                bestScore: result.totalScore,
                estimatedCompletionMilliseconds:
                    result.completionMilliseconds,
            },
        };
    }

    private evaluateRec(
        context: PlanningContext,
        agentPosition: Position,
        desires: ReadonlySet<Desire>,
        carriedParcelIds: readonly string[],
        elapsedMilliseconds: number,
        nodeId: string,
        depth: number,
        nodes: OptionEvaluationNode[],
        edges: OptionEvaluationEdge[],
        deliveryCellCandidates: readonly Position[],
        remainingCellScoreEffects: readonly CellScoreEffect[],
    ): EvaluationResult {
        let bestResult: EvaluationResult = {
            bestSequence: [],
            totalScore: 0,
            completionMilliseconds: elapsedMilliseconds,
        };
        let selectedCandidate: EvaluatedCandidate | undefined;
        const evaluatedCandidates: EvaluatedCandidate[] = [];
        let optionOrder = 0;

        for (const desire of desires) {
            const currentOptionOrder = optionOrder;
            optionOrder += 1;
            const assessment = this.assessTraversability(
                context,
                agentPosition,
                desire.targetCell,
                remainingCellScoreEffects,
            );

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
                    realizedCellScore: 0,
                    estimatedActionScore: undefined,
                    remainingParcelScore: undefined,
                    branchUpperBound: undefined,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.UNREACHABLE,
                });
                continue;
            }

            const newElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(
                    assessment.distance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                );
            const remainingDesires = new Set(desires);
            remainingDesires.delete(desire);
            const triggeredCellEffectIds = new Set(
                assessment.triggeredCellEffectIds,
            );
            for (const candidate of remainingDesires) {
                if (
                    candidate instanceof VisitCellDesire
                    && triggeredCellEffectIds.has(candidate.missionId)
                ) {
                    remainingDesires.delete(candidate);
                }
            }
            const nextCellScoreEffects = remainingCellScoreEffects.filter(
                (effect: CellScoreEffect): boolean =>
                    !triggeredCellEffectIds.has(effect.id),
            );

            let newCarriedIds = [...carriedParcelIds];
            let deliveryScoreForThisOption = 0;

            if (desire instanceof PickUpParcelDesire) {
                newCarriedIds.push(desire.parcelId);

                const hasDeliveryDesire = [...remainingDesires].some(
                    (candidate: Desire): boolean =>
                        candidate instanceof DeliverParcelsDesire,
                );
                if (!hasDeliveryDesire) {
                    for (const deliveryCell of deliveryCellCandidates) {
                        remainingDesires.add(
                            new DeliverParcelsDesire(deliveryCell),
                        );
                    }
                }
            } else if (desire instanceof DeliverParcelsDesire) {
                deliveryScoreForThisOption = this.computeDeliveryScore(
                    context,
                    carriedParcelIds,
                    newElapsedMilliseconds,
                );
                newCarriedIds = [];
                for (const candidate of remainingDesires) {
                    if (candidate instanceof DeliverParcelsDesire) {
                        remainingDesires.delete(candidate);
                    }
                }
            }

            const targetNodeId = `${nodeId}/${desire.identity()}`;
            const remainingParcelIds = [...remainingDesires]
                .filter(
                    (candidate: Desire): candidate is PickUpParcelDesire =>
                        candidate instanceof PickUpParcelDesire,
                )
                .map((candidate: PickUpParcelDesire): string =>
                    candidate.parcelId,
                );
            const bound = this.branchBoundEstimator.estimate(context, {
                actionType: desire.type,
                positionAfterAction: desire.targetCell,
                carriedParcelIdsAfterAction: newCarriedIds,
                remainingParcelIds,
                elapsedMillisecondsAfterAction: newElapsedMilliseconds,
                realizedDeliveryScore: deliveryScoreForThisOption,
                realizedCellScore: assessment.cellScore,
                remainingPositiveCellScore: nextCellScoreEffects.reduce(
                    (score: number, effect: CellScoreEffect): number =>
                        effect.score > 0 ? score + effect.score : score,
                    0,
                ),
                deliveryCellCandidates,
            });
            if (
                this.shouldPrune(
                    bound,
                    newElapsedMilliseconds,
                    bestResult,
                )
            ) {
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
                    realizedDeliveryScore: deliveryScoreForThisOption,
                    realizedCellScore: assessment.cellScore,
                    estimatedActionScore: bound.estimatedActionScore,
                    remainingParcelScore: bound.remainingParcelScore,
                    branchUpperBound: bound.totalScore,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.PRUNED_BY_BOUND,
                });
                continue;
            }

            const nextResult = this.evaluateRec(
                context,
                desire.targetCell,
                remainingDesires,
                newCarriedIds,
                newElapsedMilliseconds,
                targetNodeId,
                depth + 1,
                nodes,
                edges,
                deliveryCellCandidates,
                nextCellScoreEffects,
            );

            const totalScore = assessment.cellScore
                + deliveryScoreForThisOption
                + nextResult.totalScore;
            const candidateResult: EvaluationResult = {
                bestSequence: [desire, ...nextResult.bestSequence],
                totalScore,
                completionMilliseconds: nextResult.completionMilliseconds,
            };
            const evaluatedCandidate: EvaluatedCandidate = {
                order: currentOptionOrder,
                desire,
                targetNodeId,
                traversability: assessment.traversability,
                distance: assessment.distance,
                arrivalMilliseconds: newElapsedMilliseconds,
                realizedDeliveryScore: deliveryScoreForThisOption,
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
                traversability: candidate.traversability,
                estimatedDistance: candidate.distance,
                estimatedArrivalMilliseconds: candidate.arrivalMilliseconds,
                realizedDeliveryScore: candidate.realizedDeliveryScore,
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

    private shouldPrune(
        bound: OptionBranchBound,
        earliestCompletionMilliseconds: number,
        incumbent: EvaluationResult,
    ): boolean {
        if (bound.totalScore !== incumbent.totalScore) {
            return bound.totalScore < incumbent.totalScore;
        }
        return earliestCompletionMilliseconds
            >= incumbent.completionMilliseconds;
    }

    /** Separates guaranteed A* reachability from optimistic crate-relaxed reachability. */
    private assessTraversability(
        context: PlanningContext,
        startingPosition: Position,
        targetPosition: Position,
        cellScoreEffects: readonly CellScoreEffect[],
    ): TraversabilityAssessment {
        const directPath = context.pathfinder.findMovementPath(
            context.gameMap,
            startingPosition,
            targetPosition,
            context.crates,
            cellScoreEffects,
        );
        if (directPath.positions.length > 0) {
            return {
                traversability: OPTION_TRAVERSABILITY.DIRECT,
                distance: directPath.movementSteps,
                cellScore: directPath.cellScore,
                triggeredCellEffectIds:
                    directPath.triggeredCellEffectIds,
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

        const crateRelaxedPath = context.pathfinder.findMovementPath(
            context.gameMap,
            startingPosition,
            targetPosition,
            new Map<string, Position>(),
            cellScoreEffects,
        );
        return crateRelaxedPath.positions.length === 0
            ? {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
                cellScore: 0,
                triggeredCellEffectIds: [],
            }
            : {
                traversability:
                    OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING,
                distance: crateRelaxedPath.movementSteps,
                cellScore: crateRelaxedPath.cellScore,
                triggeredCellEffectIds:
                    crateRelaxedPath.triggeredCellEffectIds,
            };
    }

    /** Maximizes reward first, then avoids work that earns no additional reward. */
    private isBetterResult(
        candidate: EvaluationResult,
        currentBest: EvaluationResult,
    ): boolean {
        if (candidate.totalScore !== currentBest.totalScore) {
            return candidate.totalScore > currentBest.totalScore;
        }
        return candidate.completionMilliseconds
            < currentBest.completionMilliseconds;
    }

    private computeDeliveryScore(
        context: PlanningContext,
        carriedParcelIds: readonly string[],
        elapsedMilliseconds: number,
    ): number {
        let deliveryScore = 0;

        for (const parcelId of carriedParcelIds) {
            const parcel = context.parcels.get(parcelId);
            if (!parcel) {
                continue;
            }

            deliveryScore += RewardDecayEstimator.remainingReward(
                parcel.reward,
                elapsedMilliseconds,
                context.rewardDecayInterval,
                context.millisecondsUntilNextRewardDecay,
            );
        }

        return deliveryScore;
    }
}
