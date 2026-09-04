import { strict as assert } from "node:assert";
import test from "node:test";
import {
    DELIVERY_CANDIDATE_SELECTION_REASON,
    DELIVERY_PARCEL_REWARD_ELIGIBILITY,
    DeliveryCandidateFactory,
} from "./_delivery-scoring.js";
import {
    BaseOptionBranchBoundEstimator,
    ConservativeRewardBranchBoundEstimator,
    EarliestDeliveryRewardBranchBoundEstimator,
    type OptionBranchBound,
    type OptionBranchCandidate,
} from "./_option-pruning.js";
import type { Parcel } from "./bdi/beliefs.js";
import { Beliefs } from "./bdi/beliefs.js";
import {
    DeliverParcelsDesire,
    Desire,
    DesireGenerator,
    type DesireGeneration,
} from "./bdi/desires.js";
import {
    OPTION_BRANCH_DECISION,
    OptionEvaluator,
    type OptionEvaluation,
} from "./bdi/option_evaluator.js";
import type { PlanningContext } from "./planning.js";
import type { IOSensedAgent } from "../types/IOSensing.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import {
    ActionFactory,
    type GameClient,
    type MoveDirection,
    type ParcelActionAcknowledgement,
} from "./utils/move.js";
import { Position } from "./utils/position.js";

/** Aggregate search measurements reported for one validation configuration. */
interface PlannerValidationMeasurement {
    readonly deliveryCandidateCount: number;
    readonly completedPlans: number;
    readonly nodes: number;
    readonly edges: number;
    readonly prunedEdges: number;
    readonly bestScore: number;
    readonly sequence: string;
}

/** World description used to construct an immutable planner snapshot. */
interface PlannerValidationScenario {
    readonly width: number;
    readonly height: number;
    readonly agentPosition: Position;
    readonly deliveryCells: readonly Position[];
    readonly parcels: readonly Parcel[];
    readonly movementDuration: number;
    readonly rewardDecayInterval: number | undefined;
    readonly millisecondsUntilNextRewardDecay: number | undefined;
}

/** Client boundary required by ActionFactory but never executed in evaluation. */
class InertValidationGameClient implements GameClient {
    async emitMove(
        _direction: MoveDirection,
    ): Promise<{ x: number; y: number } | false> {
        return false;
    }

    async emitPickup(): Promise<readonly ParcelActionAcknowledgement[]> {
        return [];
    }

    async emitPutdown(
        _selected?: string[] | null,
    ): Promise<readonly ParcelActionAcknowledgement[]> {
        return [];
    }

    async emitSay(
        _toId: string,
        _message: unknown,
    ): Promise<"successful" | "failed"> {
        return "failed";
    }
}

/** Disables pruning while retaining the evaluator's ordinary recursion. */
class ExhaustiveOptionBranchBoundEstimator
    extends BaseOptionBranchBoundEstimator {
    override estimate(
        _context: PlanningContext,
        _candidate: OptionBranchCandidate,
    ): OptionBranchBound {
        return {
            estimatedActionScore: Number.POSITIVE_INFINITY,
            remainingParcelScore: Number.POSITIVE_INFINITY,
            totalScore: Number.POSITIVE_INFINITY,
        };
    }
}

/** Exposes every reachable delivery cell to isolate candidate-pool reduction. */
class AllDeliveryCellsDesireGenerator extends DesireGenerator {
    override generate(
        context: PlanningContext,
        excludedRootDesireIdentities?: ReadonlySet<string>,
    ): DesireGeneration {
        const ordinaryGeneration = super.generate(
            context,
            excludedRootDesireIdentities,
        );
        const deliveryCellCandidates = context.deliveringCells.map(
            (cell: Position) => DeliveryCandidateFactory.make(
                cell,
                context.deliveryScoreEffects,
                DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL,
                DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE,
            ),
        );
        const rootDesires = new Set<Desire>(
            [...ordinaryGeneration.rootDesires].filter(
                (desire: Desire): boolean =>
                    !(desire instanceof DeliverParcelsDesire),
            ),
        );
        if (ordinaryGeneration.carriedParcelIds.length > 0) {
            for (const candidate of deliveryCellCandidates) {
                const desire = new DeliverParcelsDesire(candidate);
                if (!excludedRootDesireIdentities?.has(desire.identity())) {
                    rootDesires.add(desire);
                }
            }
        }

        return {
            rootDesires,
            carriedParcelIds: ordinaryGeneration.carriedParcelIds,
            deliveryCellCandidates,
        };
    }
}

/** Creates frozen scenarios and summarizes evaluator traces. */
class PlannerValidationHarness {
    static context(scenario: PlannerValidationScenario): PlanningContext {
        const mapRows = Array.from(
            { length: scenario.width },
            (): string[] => Array.from(
                { length: scenario.height },
                (): string => "1",
            ),
        );
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(
            new InertValidationGameClient(),
            beliefs,
        );
        const parcels = new Map<string, Parcel>(
            scenario.parcels.map(
                (parcel: Parcel): [string, Parcel] => [parcel.id, parcel],
            ),
        );

        return {
            gameMap: new GameMap(mapRows),
            agentPosition: scenario.agentPosition,
            crates: new Map<string, Position>(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map<string, number>(),
            deliveringCells: scenario.deliveryCells,
            parcels,
            pickupExcludedParcelIds: new Set<string>(),
            sensedAgents: new Map<string, IOSensedAgent>(),
            movementDuration: scenario.movementDuration,
            frameDuration: 0,
            observationDistance: -1,
            rewardDecayInterval: scenario.rewardDecayInterval,
            millisecondsUntilNextRewardDecay:
                scenario.millisecondsUntilNextRewardDecay,
            agentId: "validation-agent",
            pathfinder: new AStarPathfinder(actionFactory),
            actionFactory,
            cellScoreEffects: [],
            deliveryScoreEffects: [],
        };
    }

    static measure(
        context: PlanningContext,
        desireGenerator: DesireGenerator,
        estimator: BaseOptionBranchBoundEstimator,
    ): PlannerValidationMeasurement {
        const evaluation = new OptionEvaluator(
            desireGenerator,
            estimator,
        ).evaluateWithGraph(context);
        return PlannerValidationHarness.summarize(
            context,
            desireGenerator,
            evaluation,
        );
    }

    static completePlanCombinationCount(
        parcelCount: number,
        deliveryCandidateCount: number,
    ): number {
        if (parcelCount <= 0 || deliveryCandidateCount <= 0) {
            return 0;
        }
        return PlannerValidationHarness.factorial(parcelCount)
            * deliveryCandidateCount
            * (1 + deliveryCandidateCount) ** (parcelCount - 1);
    }

    private static summarize(
        context: PlanningContext,
        desireGenerator: DesireGenerator,
        evaluation: OptionEvaluation,
    ): PlannerValidationMeasurement {
        const generation = desireGenerator.generate(context);
        const availableParcelCount = [...context.parcels.values()].filter(
            (parcel: Parcel): boolean => parcel.carriedBy === undefined,
        ).length;
        return {
            deliveryCandidateCount:
                generation.deliveryCellCandidates.length,
            completedPlans: evaluation.graph.nodes.filter(
                (node): boolean => {
                    const steps = node.id.split("/");
                    return node.carriedParcelIds.length === 0
                        && steps.filter(
                            (step: string): boolean =>
                                step.startsWith("pick:"),
                        ).length === availableParcelCount
                        && steps[steps.length - 1]?.startsWith("drop:")
                            === true;
                },
            ).length,
            nodes: evaluation.graph.nodes.length,
            edges: evaluation.graph.edges.length,
            prunedEdges: evaluation.graph.edges.filter(
                (edge): boolean => edge.decision
                    === OPTION_BRANCH_DECISION.PRUNED_BY_BOUND,
            ).length,
            bestScore: evaluation.graph.bestScore,
            sequence: evaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ).join(" -> "),
        };
    }

    private static factorial(value: number): number {
        let result = 1;
        for (let factor = 2; factor <= value; factor += 1) {
            result *= factor;
        }
        return result;
    }
}

/** Canonical deterministic inputs cited by the validation section. */
class PlannerValidationScenarios {
    static greedyCounterexample(): PlannerValidationScenario {
        return {
            width: 10,
            height: 1,
            agentPosition: new Position(5, 0),
            deliveryCells: [new Position(9, 0)],
            parcels: [
                PlannerValidationScenarios.parcel("left", 4, 0, 4),
                PlannerValidationScenarios.parcel("right", 7, 0, 6),
            ],
            movementDuration: 100,
            rewardDecayInterval: 1_000,
            millisecondsUntilNextRewardDecay: 1_000,
        };
    }

    static pruningComparison(): PlannerValidationScenario {
        return {
            width: 7,
            height: 7,
            agentPosition: new Position(3, 1),
            deliveryCells: [
                new Position(3, 0),
                new Position(3, 6),
                new Position(0, 3),
                new Position(6, 3),
                new Position(0, 0),
                new Position(6, 0),
            ],
            parcels: [
                PlannerValidationScenarios.parcel("west", 3, 0, 10),
                PlannerValidationScenarios.parcel("east", 3, 6, 9),
                PlannerValidationScenarios.parcel("north-east", 0, 6, 8),
                PlannerValidationScenarios.parcel("south-east", 6, 6, 7),
            ],
            movementDuration: 100,
            rewardDecayInterval: 1_000,
            millisecondsUntilNextRewardDecay: 400,
        };
    }

    private static parcel(
        id: string,
        x: number,
        y: number,
        reward: number,
    ): Parcel {
        return {
            id,
            x,
            y,
            reward,
            carriedBy: undefined,
            lastUpdate: new Date(0),
        };
    }
}

test(
    "branch-and-bound avoids a one-step greedy pickup counterexample",
    (): void => {
        const context = PlannerValidationHarness.context(
            PlannerValidationScenarios.greedyCounterexample(),
        );
        const evaluator = new OptionEvaluator(new DesireGenerator());
        const leftOnly = evaluator.evaluateWithGraph(
            context,
            new Set<string>(["pick:right"]),
        );
        const rightOnly = evaluator.evaluateWithGraph(
            context,
            new Set<string>(["pick:left"]),
        );
        const lookahead = evaluator.evaluateWithGraph(context);

        assert.equal(leftOnly.graph.bestScore, 3);
        assert.equal(rightOnly.graph.bestScore, 5);
        assert.equal(rightOnly.bestSequence[0]?.identity(), "pick:right");
        assert.equal(lookahead.graph.bestScore, 8);
        assert.deepEqual(
            lookahead.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
            ["pick:left", "pick:right", "drop:9,0"],
        );
    },
);

test(
    "candidate reduction and both bounds preserve the full-search optimum",
    (): void => {
        const context = PlannerValidationHarness.context(
            PlannerValidationScenarios.pruningComparison(),
        );
        const exhaustiveEstimator =
            new ExhaustiveOptionBranchBoundEstimator();
        const allDeliveries = PlannerValidationHarness.measure(
            context,
            new AllDeliveryCellsDesireGenerator(),
            exhaustiveEstimator,
        );
        const reducedExhaustive = PlannerValidationHarness.measure(
            context,
            new DesireGenerator(),
            exhaustiveEstimator,
        );
        const conservative = PlannerValidationHarness.measure(
            context,
            new DesireGenerator(),
            new ConservativeRewardBranchBoundEstimator(),
        );
        const earliestDelivery = PlannerValidationHarness.measure(
            context,
            new DesireGenerator(),
            new EarliestDeliveryRewardBranchBoundEstimator(),
        );

        console.log(JSON.stringify({
            allDeliveries,
            reducedExhaustive,
            conservative,
            earliestDelivery,
        }, undefined, 2));

        assert.equal(allDeliveries.deliveryCandidateCount, 6);
        assert.equal(reducedExhaustive.deliveryCandidateCount, 2);
        assert.deepEqual(
            new DesireGenerator().generate(context).deliveryCellCandidates
                .map((candidate): string =>
                    `${candidate.cell.x},${candidate.cell.y}`,
                ),
            ["3,0", "3,6"],
        );
        assert.equal(
            PlannerValidationHarness.completePlanCombinationCount(4, 6),
            49_392,
        );
        assert.equal(
            PlannerValidationHarness.completePlanCombinationCount(4, 2),
            1_296,
        );
        assert.equal(allDeliveries.bestScore, 23);
        assert.equal(reducedExhaustive.bestScore, allDeliveries.bestScore);
        assert.equal(conservative.bestScore, reducedExhaustive.bestScore);
        assert.equal(
            earliestDelivery.bestScore,
            reducedExhaustive.bestScore,
        );
        assert.equal(allDeliveries.nodes, 66_473);
        assert.equal(allDeliveries.completedPlans, 49_392);
        assert.equal(reducedExhaustive.nodes, 2_713);
        assert.equal(reducedExhaustive.completedPlans, 1_296);
        assert.equal(conservative.nodes, 1_127);
        assert.equal(conservative.completedPlans, 392);
        assert.equal(conservative.prunedEdges, 316);
        assert.equal(earliestDelivery.nodes, 396);
        assert.equal(earliestDelivery.completedPlans, 148);
        assert.equal(earliestDelivery.prunedEdges, 116);
        assert.ok(conservative.nodes < reducedExhaustive.nodes);
        assert.ok(earliestDelivery.nodes <= conservative.nodes);

    },
);
