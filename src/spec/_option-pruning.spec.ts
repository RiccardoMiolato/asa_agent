import { strict as assert } from "node:assert";
import test from "node:test";
import type { IOSensedAgent } from "../../types/IOSensing.js";
import type { Parcel } from "../bdi/beliefs.js";
import { Beliefs } from "../bdi/beliefs.js";
import {
    DESIRE_TYPE,
    Desire,
    DesireGenerator,
} from "../bdi/desires.js";
import {
    OPTION_BRANCH_DECISION,
    OptionEvaluator,
} from "../bdi/option_evaluator.js";
import type { PlanningContext } from "../bdi/planning.js";
import { BranchAndBoundSvgRenderer } from "../utils/_branch-and-bound-svg.js";
import {
    DELIVERY_CANDIDATE_SELECTION_REASON,
    DELIVERY_PARCEL_REWARD_ELIGIBILITY,
    DeliveryCandidateFactory,
    type DeliveryCandidate,
} from "../utils/_delivery-scoring.js";
import {
    BaseOptionBranchBoundEstimator,
    ConservativeRewardBranchBoundEstimator,
    EarliestDeliveryRewardBranchBoundEstimator,
    type OptionBranchBound,
    type OptionBranchCandidate,
} from "../utils/_option-pruning.js";
import { BasePathfinder } from "../utils/astar.js";
import { GameMap } from "../utils/map.js";
import {
    Action,
    ActionFactory,
    type GameClient,
    type MoveDirection,
    type ParcelActionAcknowledgement,
} from "../utils/move.js";
import { Position } from "../utils/position.js";

/** Inert movement step used by deterministic path-length tests. */
class NoOpAction extends Action {
    async execute(): Promise<true> {
        return true;
    }
}

/** Manhattan-distance pathfinder used to make branch timing predictable. */
class ManhattanPathfinder extends BasePathfinder {
    findPath(
        _gameMap: GameMap,
        startingPosition: Position,
        targetPosition: Position,
        _crates: ReadonlyMap<string, Position>,
    ): Action[] {
        return Array.from(
            { length: startingPosition.distanceTo(targetPosition) },
            (): Action => new NoOpAction(),
        );
    }
}

/** Game client stub required by the action factory. */
class NoOpGameClient implements GameClient {
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

/** Disables pruning while retaining the same evaluator traversal order. */
class ExhaustiveBranchBoundEstimator
    extends BaseOptionBranchBoundEstimator {
    override estimate(
        _context: PlanningContext,
        _candidate: OptionBranchCandidate,
    ): OptionBranchBound {
        return {
            estimatedActionScore: Number.POSITIVE_INFINITY,
            remainingParcelScore: 0,
            totalScore: Number.POSITIVE_INFINITY,
        };
    }
}

/** Creates deterministic contexts for branch-bound behavior. */
class OptionPruningFixture {
    static context(): PlanningContext {
        const nearbyParcel = OptionPruningFixture.parcel(
            "nearby",
            1,
            0,
            10,
        );
        const distantParcel = OptionPruningFixture.parcel(
            "distant",
            20,
            0,
            1,
        );
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(
            new NoOpGameClient(),
            beliefs,
        );

        return {
            gameMap: new GameMap([["1"]]),
            agentPosition: new Position(0, 0),
            crates: new Map<string, Position>(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map<string, number>(),
            deliveringCells: [new Position(2, 0)],
            parcels: new Map<string, Parcel>([
                [nearbyParcel.id, nearbyParcel],
                [distantParcel.id, distantParcel],
            ]),
            pickupExcludedParcelIds: new Set<string>(),
            sensedAgents: new Map<string, IOSensedAgent>(),
            movementDuration: 100,
            frameDuration: 0,
            observationDistance: 5,
            rewardDecayInterval: 1_000,
            millisecondsUntilNextRewardDecay: 1_000,
            agentId: "agent-1",
            pathfinder: new ManhattanPathfinder(),
            actionFactory,
            cellScoreEffects: [],
            deliveryScoreEffects: [],
        };
    }

    /** Creates a case where travel decay separates the admissible bounds. */
    static tighterBoundContext(): PlanningContext {
        const context = OptionPruningFixture.context();
        const distantParcel = context.parcels.get("distant");
        assert.ok(distantParcel !== undefined);

        return {
            ...context,
            parcels: new Map<string, Parcel>([
                ...[...context.parcels.entries()].filter(
                    ([parcelId]: [string, Parcel]): boolean =>
                        parcelId !== distantParcel.id,
                ),
                [distantParcel.id, { ...distantParcel, x: 2 }],
            ]),
            rewardDecayInterval: 400,
            millisecondsUntilNextRewardDecay: 400,
        };
    }

    static deliveryCandidates(
        context: PlanningContext,
    ): readonly DeliveryCandidate[] {
        return context.deliveringCells.map(
            (cell: Position): DeliveryCandidate =>
                DeliveryCandidateFactory.make(
                    cell,
                    context.deliveryScoreEffects,
                    DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL,
                    DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE,
                ),
        );
    }

    static pickupCandidate(
        context: PlanningContext,
        remainingParcelIds: readonly string[],
    ): OptionBranchCandidate {
        return {
            actionType: DESIRE_TYPE.PICK_UP,
            positionAfterAction: new Position(1, 0),
            carriedParcelIdsAfterAction: ["nearby"],
            remainingParcelIds,
            elapsedMillisecondsAfterAction: 300,
            realizedDeliveryScore: 0,
            realizedCellScore: 0,
            remainingPositiveCellScore: 0,
            deliveryCellCandidates:
                OptionPruningFixture.deliveryCandidates(context),
            remainingDeliveryEffectIds: new Set(),
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
    "pickup bounds combine path-aware delivery and remaining rewards",
    (): void => {
        const context = OptionPruningFixture.context();
        const bound = new ConservativeRewardBranchBoundEstimator().estimate(
            context,
            OptionPruningFixture.pickupCandidate(context, ["distant"]),
        );

        assert.deepEqual(bound, {
            estimatedActionScore: 10,
            remainingParcelScore: 1,
            totalScore: 11,
        });
    },
);

test(
    "earliest-delivery bounds decay uncollected parcels by unavoidable work",
    (): void => {
        const context = OptionPruningFixture.context();
        const bound = new EarliestDeliveryRewardBranchBoundEstimator().estimate(
            context,
            OptionPruningFixture.pickupCandidate(context, ["distant"]),
        );

        assert.deepEqual(bound, {
            estimatedActionScore: 10,
            remainingParcelScore: 0,
            totalScore: 10,
        });
    },
);

test(
    "the evaluator prunes a branch whose bound cannot beat the incumbent",
    (): void => {
        const context = OptionPruningFixture.context();
        const evaluation = new OptionEvaluator(
            new DesireGenerator(),
        ).evaluateWithGraph(context);
        const exhaustiveEvaluation = new OptionEvaluator(
            new DesireGenerator(),
            new ExhaustiveBranchBoundEstimator(),
        ).evaluateWithGraph(context);
        const rootEdges = evaluation.graph.edges.filter(
            (edge): boolean =>
                edge.sourceNodeId === evaluation.graph.rootNodeId,
        );
        const distantPickup = rootEdges.find(
            (edge): boolean => edge.optionIdentity === "pick:distant",
        );

        assert.deepEqual(
            evaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
            ["pick:nearby", "drop:2,0"],
        );
        assert.equal(evaluation.graph.bestScore, 10);
        assert.deepEqual(
            evaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
            exhaustiveEvaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
        );
        assert.equal(
            evaluation.graph.bestScore,
            exhaustiveEvaluation.graph.bestScore,
        );
        assert.ok(
            evaluation.graph.nodes.length
                < exhaustiveEvaluation.graph.nodes.length,
        );
        for (const edge of evaluation.graph.edges) {
            if (edge.branchScore === undefined) {
                continue;
            }
            assert.ok(edge.branchUpperBound !== undefined);
            assert.ok(edge.branchScore <= edge.branchUpperBound);
        }
        assert.equal(
            distantPickup?.decision,
            OPTION_BRANCH_DECISION.PRUNED_BY_BOUND,
        );
        assert.equal(distantPickup?.estimatedActionScore, 0);
        assert.equal(distantPickup?.remainingParcelScore, 2);
        assert.equal(distantPickup?.branchUpperBound, 2);
        assert.equal(distantPickup?.branchScore, undefined);
        assert.equal(distantPickup?.targetNodeId, undefined);

        const svg = new BranchAndBoundSvgRenderer().render(
            evaluation.graph,
            {
                agentId: context.agentId,
                cycle: 1,
                pass: 1,
            },
        );
        assert.match(svg, /PRUNED/);
        assert.match(svg, /upper bound 2\.000/);
    },
);

test(
    "earliest-delivery bounds visit fewer nodes than immediate-reward bounds",
    (): void => {
        const context = OptionPruningFixture.tighterBoundContext();
        const evaluation = new OptionEvaluator(
            new DesireGenerator(),
        ).evaluateWithGraph(context);
        const conservativeEvaluation = new OptionEvaluator(
            new DesireGenerator(),
            new ConservativeRewardBranchBoundEstimator(),
        ).evaluateWithGraph(context);
        const exhaustiveEvaluation = new OptionEvaluator(
            new DesireGenerator(),
            new ExhaustiveBranchBoundEstimator(),
        ).evaluateWithGraph(context);

        assert.deepEqual(
            evaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
            exhaustiveEvaluation.bestSequence.map(
                (desire: Desire): string => desire.identity(),
            ),
        );
        assert.equal(
            evaluation.graph.bestScore,
            exhaustiveEvaluation.graph.bestScore,
        );
        assert.ok(
            evaluation.graph.nodes.length
                < conservativeEvaluation.graph.nodes.length,
        );
    },
);
