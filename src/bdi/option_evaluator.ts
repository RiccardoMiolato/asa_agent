import { RewardDecayEstimator } from "../utils/_reward-decay.js";
import { Position } from "../utils/position.js";
import { Parcel } from "./beliefs.js";
import { IntentionContext } from "./intentions.js";

export type OptionType = "pick" | "drop";

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

/** One pickup or drop edge considered from an evaluation node. */
export interface OptionEvaluationEdge {
    readonly order: number;
    readonly sourceNodeId: string;
    readonly targetNodeId: string | undefined;
    readonly optionIdentity: string;
    readonly optionType: OptionType;
    readonly parcelId: string | undefined;
    readonly targetPosition: Position;
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly estimatedDistance: number | undefined;
    readonly estimatedArrivalMilliseconds: number | undefined;
    readonly immediateDeliveryScore: number;
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
    readonly bestSequence: Option[];
    readonly graph: OptionEvaluationGraph;
}

export class Option {
    private optionType: OptionType;
    private parcelId: string | undefined;
    private targetCell: Position;
    private score: number;

    constructor(optionType: OptionType, targetCell: Position, parcelId: string | undefined = undefined) {
        this.optionType = optionType;
        this.targetCell = targetCell;
        this.score = -Infinity;

        if(this.optionType === "pick")
            this.parcelId = parcelId;
    }

    getType (): OptionType {
        return this.optionType;
    }

    getTargetCell (): Position {
        return this.targetCell;
    }

    getParcelId (): string | undefined {
        return this.parcelId;
    }

    /** Stable identity used to reject only a failed root choice during replanning. */
    identity(): string {
        if (this.optionType === "pick") {
            return `pick:${this.parcelId ?? "missing"}`;
        }
        return `drop:${this.targetCell.x},${this.targetCell.y}`;
    }

    getScore(): number {
        return this.score;
    }

    setScore(score: number) {
        this.score = score;
    }
}

interface EvaluationResult {
    bestSequence: Option[];
    totalScore: number;
    completionMilliseconds: number;
}

interface TraversabilityAssessment {
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly distance: number | undefined;
}

interface EvaluatedCandidate {
    readonly order: number;
    readonly option: Option;
    readonly targetNodeId: string;
    readonly traversability: OPTION_TRAVERSABILITY;
    readonly distance: number;
    readonly arrivalMilliseconds: number;
    readonly immediateDeliveryScore: number;
    readonly result: EvaluationResult;
}

export class OptionEvaluator {
    evaluate(
        context: IntentionContext,
        excludedRootOptionIdentities?: ReadonlySet<string>,
    ): Option[] {
        return this.evaluateWithGraph(
            context,
            excludedRootOptionIdentities,
        ).bestSequence;
    }

    /** Evaluates options while retaining every visited node and considered edge. */
    evaluateWithGraph(
        context: IntentionContext,
        excludedRootOptionIdentities?: ReadonlySet<string>,
    ): OptionEvaluation {
        const optionSet: Set<Option> = new Set();
        const carriedParcelIds: string[] = [];

        context.parcels.forEach((parcel: Parcel) => {
            if(parcel.carriedBy === context.agentId) {
                carriedParcelIds.push(parcel.id);
            } else if (!parcel.carriedBy) {
                const parcelOption = new Option(
                    "pick",
                    new Position(parcel.x, parcel.y),
                    parcel.id
                );
                this.addRootOption(
                    optionSet,
                    parcelOption,
                    excludedRootOptionIdentities,
                );
            }
        });

        if(carriedParcelIds.length > 0){
            for (const deliveryCell of context.deliveringCells) {
                this.addRootOption(
                    optionSet,
                    new Option("drop", deliveryCell),
                    excludedRootOptionIdentities,
                );
            }
        }

        const nodes: OptionEvaluationNode[] = [];
        const edges: OptionEvaluationEdge[] = [];
        const rootNodeId = "root";
        const result = this.evaluateRec(
            context,
            context.agentPosition,
            optionSet,
            carriedParcelIds,
            0,
            rootNodeId,
            0,
            nodes,
            edges,
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

    private addRootOption(
        optionSet: Set<Option>,
        option: Option,
        excludedRootOptionIdentities: ReadonlySet<string> | undefined,
    ): void {
        if (excludedRootOptionIdentities?.has(option.identity())) {
            return;
        }
        optionSet.add(option);
    }

    private evaluateRec(
        context: IntentionContext,
        agentPosition: Position,
        optionSet: Set<Option>,
        carriedParcelIds: string[],
        elapsedMilliseconds: number,
        nodeId: string,
        depth: number,
        nodes: OptionEvaluationNode[],
        edges: OptionEvaluationEdge[],
    ): EvaluationResult {
        let bestResult: EvaluationResult = {
            bestSequence: [],
            totalScore: 0,
            completionMilliseconds: elapsedMilliseconds,
        };
        let selectedCandidate: EvaluatedCandidate | undefined;
        const evaluatedCandidates: EvaluatedCandidate[] = [];
        let optionOrder = 0;

        optionSet.forEach((option: Option) => {
            const currentOptionOrder = optionOrder;
            optionOrder += 1;
            const assessment = this.assessTraversability(
                context,
                agentPosition,
                option.getTargetCell(),
            );

            if (assessment.distance === undefined) {
                edges.push({
                    order: currentOptionOrder,
                    sourceNodeId: nodeId,
                    targetNodeId: undefined,
                    optionIdentity: option.identity(),
                    optionType: option.getType(),
                    parcelId: option.getParcelId(),
                    targetPosition: option.getTargetCell(),
                    traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                    estimatedDistance: undefined,
                    estimatedArrivalMilliseconds: undefined,
                    immediateDeliveryScore: 0,
                    branchScore: undefined,
                    decision: OPTION_BRANCH_DECISION.UNREACHABLE,
                });
                return;
            }

            const newElapsedMilliseconds = elapsedMilliseconds
                + RewardDecayEstimator.actionSequenceDurationMilliseconds(
                    assessment.distance,
                    1,
                    context.movementDuration,
                    context.frameDuration,
                );
            const newOptionSet: Set<Option> = new Set(optionSet);
            newOptionSet.delete(option);

            let newCarriedIds = [...carriedParcelIds];
            let scoreForThisOption = 0;

            if (option.getType() === "pick") {
                newCarriedIds.push(option.getParcelId()!);

                const hasDropOption = [...newOptionSet].some(
                    (candidate: Option): boolean => candidate.getType() === "drop",
                );
                if (!hasDropOption) {
                    for (const deliveryCell of context.deliveringCells) {
                        newOptionSet.add(new Option("drop", deliveryCell));
                    }
                }
            } else {
                scoreForThisOption = this.computeDeliveryScore(
                    context,
                    carriedParcelIds,
                    newElapsedMilliseconds,
                );
                newCarriedIds = [];
                for (const candidate of newOptionSet) {
                    if (candidate.getType() === "drop") {
                        newOptionSet.delete(candidate);
                    }
                }
            }

            const targetNodeId = `${nodeId}/${option.identity()}`;
            const nextResult = this.evaluateRec(
                context,
                option.getTargetCell(),
                newOptionSet,
                newCarriedIds,
                newElapsedMilliseconds,
                targetNodeId,
                depth + 1,
                nodes,
                edges,
            );

            const totalScore = scoreForThisOption + nextResult.totalScore;
            option.setScore(totalScore);

            const candidateResult: EvaluationResult = {
                bestSequence: [option, ...nextResult.bestSequence],
                totalScore,
                completionMilliseconds: nextResult.completionMilliseconds,
            };
            const evaluatedCandidate: EvaluatedCandidate = {
                order: currentOptionOrder,
                option,
                targetNodeId,
                traversability: assessment.traversability,
                distance: assessment.distance,
                arrivalMilliseconds: newElapsedMilliseconds,
                immediateDeliveryScore: scoreForThisOption,
                result: candidateResult,
            };
            evaluatedCandidates.push(evaluatedCandidate);
            if (this.isBetterResult(candidateResult, bestResult)) {
                bestResult = candidateResult;
                selectedCandidate = evaluatedCandidate;
            }
        });

        for (const candidate of evaluatedCandidates) {
            edges.push({
                order: candidate.order,
                sourceNodeId: nodeId,
                targetNodeId: candidate.targetNodeId,
                optionIdentity: candidate.option.identity(),
                optionType: candidate.option.getType(),
                parcelId: candidate.option.getParcelId(),
                targetPosition: candidate.option.getTargetCell(),
                traversability: candidate.traversability,
                estimatedDistance: candidate.distance,
                estimatedArrivalMilliseconds: candidate.arrivalMilliseconds,
                immediateDeliveryScore: candidate.immediateDeliveryScore,
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
            selectedOptionIdentity: selectedCandidate?.option.identity(),
        });

        return bestResult;
    }

    /** Separates guaranteed A* reachability from optimistic crate-relaxed reachability. */
    private assessTraversability(
        context: IntentionContext,
        startingPosition: Position,
        targetPosition: Position,
    ): TraversabilityAssessment {
        const directDistance = context.pathfinder.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            context.crates,
        );
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

        const crateRelaxedDistance = context.pathfinder.pathLength(
            context.gameMap,
            startingPosition,
            targetPosition,
            new Map<string, Position>(),
        );
        return crateRelaxedDistance === undefined
            ? {
                traversability: OPTION_TRAVERSABILITY.UNREACHABLE,
                distance: undefined,
            }
            : {
                traversability:
                    OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING,
                distance: crateRelaxedDistance,
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
        context: IntentionContext,
        carriedParcelIds: string[],
        elapsedMilliseconds: number,
    ): number {
        let deliveryScore = 0;

        carriedParcelIds.forEach((parcelId: string) => {
            const parcel = context.parcels.get(parcelId);

            if(parcel) {
                const remainingReward = RewardDecayEstimator.remainingReward(
                    parcel.reward,
                    elapsedMilliseconds,
                    context.rewardDecayInterval,
                    context.millisecondsUntilNextRewardDecay,
                );
                deliveryScore += remainingReward;
            }
        });

        return deliveryScore;
    }
}
