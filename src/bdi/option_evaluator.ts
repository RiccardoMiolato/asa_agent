import {
    CellScoreEffect,
    CellScoreEffectEvaluator,
    CellScoreEffectId,
} from "../utils/_cell-score-effects.js";
import {
    DELIVERY_CANDIDATE_SELECTION_REASON,
    type DeliveryCandidate,
    type DeliveryScoreEffectId,
} from "../utils/_delivery-scoring.js";
import { DeliveryTimingOptimizer } from "../utils/_delivery-timing.js";
import { BaseOptionBranchBoundEstimator, EarliestDeliveryRewardBranchBoundEstimator, OptionBranchBound } from "../utils/_option-pruning.js";
import { RewardDecayEstimator } from "../utils/_reward-decay.js";
import { Position } from "../utils/position.js";
import {
    DeliverParcelsDesire,
    Desire,
    DesireGenerator,
    PickUpParcelDesire,
    VisitCellDesire,
    type DESIRE_TYPE,
} from "./desires.js";
import { PlanningContext } from "./planning.js";

export {
    BaseOptionBranchBoundEstimator,
    ConservativeRewardBranchBoundEstimator,
    EarliestDeliveryRewardBranchBoundEstimator,
    type OptionBranchBound,
    type OptionBranchCandidate
} from "../utils/_option-pruning.js";

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
    /** Whether this delivery cell was added to replace a penalized selection. */
    readonly isPenaltyReplacement: boolean;
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly estimatedDistance: number | undefined;
    readonly estimatedArrivalMilliseconds: number | undefined;
    /** Intentional delay after the fastest route and before delivery. */
    readonly deliveryWaitMilliseconds: number;
    /** Reward realized on this edge; nonzero only when the action is a drop. */
    readonly realizedDeliveryScore: number;
    /** Portion of the delivery score contributed by drop-at modifiers. */
    readonly realizedDeliveryMissionScore: number;
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
    readonly deliveryWaitMilliseconds: number;
    readonly realizedDeliveryScore: number;
    readonly realizedDeliveryMissionScore: number;
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
            new Set(
                context.deliveryScoreEffects.map(
                    (effect): DeliveryScoreEffectId => effect.id,
                ),
            ),
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
        deliveryCellCandidates: readonly DeliveryCandidate[],
        remainingCellScoreEffects: readonly CellScoreEffect[],
        remainingDeliveryEffectIds:
            ReadonlySet<DeliveryScoreEffectId>,
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
                desire,
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
                    isPenaltyReplacement:
                        this.isPenaltyReplacement(desire),
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
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(
                    assessment.distance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                );
            let evaluatedDesire = desire;
            let deliveryWaitMilliseconds = 0;
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
                    !triggeredCellEffectIds.has(effect.id)
                    || !effect.isConsumable(),
            );

            let newCarriedIds = [...carriedParcelIds];
            let deliveryScoreForThisOption = 0;
            let deliveryMissionScoreForThisOption = 0;
            const nextDeliveryEffectIds = new Set(
                remainingDeliveryEffectIds,
            );

            if (desire instanceof PickUpParcelDesire) {
                newCarriedIds.push(desire.parcelId);

                const hasDeliveryDesire = [...remainingDesires].some(
                    (candidate: Desire): boolean =>
                        candidate instanceof DeliverParcelsDesire,
                );
                if (!hasDeliveryDesire) {
                    for (const deliveryCandidate of deliveryCellCandidates) {
                        remainingDesires.add(
                            new DeliverParcelsDesire(deliveryCandidate),
                        );
                    }
                }
            } else if (desire instanceof DeliverParcelsDesire) {
                const parcelRewards = this.carriedParcelRewards(
                    context,
                    carriedParcelIds,
                );
                const timing = DeliveryTimingOptimizer.maximizeScore(
                    desire.deliveryCandidate,
                    parcelRewards,
                    newElapsedMilliseconds,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                    remainingDeliveryEffectIds,
                );
                deliveryWaitMilliseconds = timing.waitMilliseconds;
                newElapsedMilliseconds += deliveryWaitMilliseconds;
                evaluatedDesire = desire.scheduledAfter(
                    deliveryWaitMilliseconds,
                );
                deliveryScoreForThisOption = timing.adjustedDeliveryScore;
                deliveryMissionScoreForThisOption =
                    deliveryScoreForThisOption - timing.baseDeliveryScore;
                for (
                    const effectId
                    of desire.deliveryCandidate.consumedEffectIds(
                        remainingDeliveryEffectIds,
                    )
                ) {
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
                remainingDeliveryEffectIds: nextDeliveryEffectIds,
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
                    isPenaltyReplacement:
                        this.isPenaltyReplacement(desire),
                    traversability: assessment.traversability,
                    estimatedDistance: assessment.distance,
                    estimatedArrivalMilliseconds: newElapsedMilliseconds,
                    deliveryWaitMilliseconds,
                    realizedDeliveryScore: deliveryScoreForThisOption,
                    realizedDeliveryMissionScore:
                        deliveryMissionScoreForThisOption,
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
                nextDeliveryEffectIds,
            );

            const totalScore = assessment.cellScore
                + deliveryScoreForThisOption
                + nextResult.totalScore;
            const candidateResult: EvaluationResult = {
                bestSequence: [evaluatedDesire, ...nextResult.bestSequence],
                totalScore,
                completionMilliseconds: nextResult.completionMilliseconds,
            };
            const evaluatedCandidate: EvaluatedCandidate = {
                order: currentOptionOrder,
                desire: evaluatedDesire,
                targetNodeId,
                traversability: assessment.traversability,
                distance: assessment.distance,
                arrivalMilliseconds: newElapsedMilliseconds,
                deliveryWaitMilliseconds,
                realizedDeliveryScore: deliveryScoreForThisOption,
                realizedDeliveryMissionScore:
                    deliveryMissionScoreForThisOption,
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
                isPenaltyReplacement:
                    this.isPenaltyReplacement(candidate.desire),
                traversability: candidate.traversability,
                estimatedDistance: candidate.distance,
                estimatedArrivalMilliseconds: candidate.arrivalMilliseconds,
                deliveryWaitMilliseconds: candidate.deliveryWaitMilliseconds,
                realizedDeliveryScore: candidate.realizedDeliveryScore,
                realizedDeliveryMissionScore:
                    candidate.realizedDeliveryMissionScore,
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

    private isPenaltyReplacement(desire: Desire): boolean {
        return desire instanceof DeliverParcelsDesire
            && desire.deliveryCandidate.selectionReason
                === DELIVERY_CANDIDATE_SELECTION_REASON.PENALTY_REPLACEMENT;
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
        desire: Desire,
        cellScoreEffects: readonly CellScoreEffect[],
    ): TraversabilityAssessment {
        const targetPosition = desire.targetCell;
        const applicableEffects = cellScoreEffects.filter(
            (effect: CellScoreEffect): boolean =>
                !effect.requiresExplicitVisit
                || desire instanceof VisitCellDesire
                    && desire.missionId === effect.id,
        );
        const directPath = context.pathfinder.findMovementPath(
            context.gameMap,
            startingPosition,
            targetPosition,
            context.crates,
            applicableEffects,
        );
        if (directPath.positions.length > 0) {
            const alreadyAtTargetEffects = startingPosition.isEqual(
                targetPosition,
            )
                ? CellScoreEffectEvaluator.triggeredAt(
                    startingPosition,
                    applicableEffects.filter(
                        (effect: CellScoreEffect): boolean =>
                            effect.requiresExplicitVisit,
                    ),
                    new Set<CellScoreEffectId>(),
                )
                : [];
            return {
                traversability: OPTION_TRAVERSABILITY.DIRECT,
                distance: directPath.movementSteps,
                cellScore: directPath.cellScore
                    + CellScoreEffectEvaluator.totalScore(
                        alreadyAtTargetEffects,
                    ),
                triggeredCellEffectIds: [
                    ...directPath.triggeredCellEffectIds,
                    ...alreadyAtTargetEffects.map(
                        (effect: CellScoreEffect): CellScoreEffectId =>
                            effect.id,
                    ),
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

        const crateRelaxedPath = context.pathfinder.findMovementPath(
            context.gameMap,
            startingPosition,
            targetPosition,
            new Map<string, Position>(),
            applicableEffects,
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

    private carriedParcelRewards(
        context: PlanningContext,
        carriedParcelIds: readonly string[],
    ): readonly number[] {
        const parcelRewards: number[] = [];

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
