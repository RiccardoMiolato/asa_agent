import assert from "node:assert/strict";
import test from "node:test";
import { BranchAndBoundSvgRenderer } from "./_branch-and-bound-svg.js";
import { Action, ActionFactory, type GameClient } from "./move.js";
import { BasePathfinder } from "./astar.js";
import { Beliefs, type Parcel } from "./beliefs.js";
import { DESIRE_TYPE, DesireGenerator } from "./desires.js";
import {
    BaseOptionBranchBoundEstimator,
    ConservativeRewardBranchBoundEstimator,
    EarliestDeliveryRewardBranchBoundEstimator,
    OPTION_BRANCH_DECISION,
    type OptionBranchBound,
    type OptionBranchCandidate,
    OptionEvaluator,
} from "./option_evaluator.js";
import type { PlanningContext } from "./planning.js";
import { Position } from "./position.js";

/** Inert movement step used by deterministic path-length tests. */
class NoOpAction extends Action {
    override async execute(): Promise<boolean> {
        return true;
    }
}

/** Manhattan-distance pathfinder used to make branch timing predictable. */
class ManhattanPathfinder extends BasePathfinder {
    override findPath(
        _gameMap: string[][],
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
        _direction: "up" | "right" | "left" | "down",
    ): Promise<false> {
        return false;
    }

    async emitPickup(): Promise<{ id: string }[]> {
        return [];
    }

    async emitPutdown(
        _selected?: string[] | null,
    ): Promise<{ id: string }[]> {
        return [];
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

/** Creates a context where collecting the nearby parcel first is optimal. */
class OptionPruningFixture {
    static context(): PlanningContext {
        const nearbyParcel: Parcel = {
            id: "nearby",
            x: 1,
            y: 0,
            reward: 10,
            carriedBy: undefined,
            lastUpdate: new Date(),
        };
        const distantParcel: Parcel = {
            id: "distant",
            x: 20,
            y: 0,
            reward: 1,
            carriedBy: undefined,
            lastUpdate: new Date(),
        };
        return {
            gameMap: [["1"]],
            agentPosition: new Position(0, 0),
            crates: new Map<string, Position>(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map<string, number>(),
            deliveringCells: [new Position(2, 0)],
            parcels: new Map<string, Parcel>([
                [nearbyParcel.id, nearbyParcel],
                [distantParcel.id, distantParcel],
            ]),
            movementDuration: 100,
            frameDuration: 0,
            observationDistance: 5,
            rewardDecayInterval: 1_000,
            millisecondsUntilNextRewardDecay: 1_000,
            agentId: "agent-1",
            pathfinder: new ManhattanPathfinder(),
            actionFactory: new ActionFactory(
                new NoOpGameClient(),
                new Beliefs(),
            ),
        };
    }

    /** Creates a case where travel decay separates the two admissible bounds. */
    static tighterBoundContext(): PlanningContext {
        const context = OptionPruningFixture.context();
        const distantParcel = context.parcels.get("distant");
        assert.ok(distantParcel !== undefined);

        return {
            ...context,
            parcels: new Map<string, Parcel>([
                ...[...context.parcels.entries()].filter(
                    ([parcelId]: readonly [string, Parcel]): boolean =>
                        parcelId !== distantParcel.id,
                ),
                [distantParcel.id, { ...distantParcel, x: 2 }],
            ]),
            rewardDecayInterval: 400,
            millisecondsUntilNextRewardDecay: 400,
        };
    }
}

test("pickup bounds combine path-aware delivery and remaining rewards", () => {
    const context = OptionPruningFixture.context();
    const bound = new ConservativeRewardBranchBoundEstimator().estimate(
        context,
        {
            actionType: DESIRE_TYPE.PICK_UP,
            positionAfterAction: new Position(1, 0),
            carriedParcelIdsAfterAction: ["nearby"],
            remainingParcelIds: ["distant"],
            elapsedMillisecondsAfterAction: 300,
            realizedDeliveryScore: 0,
            deliveryCellCandidates: context.deliveringCells,
        },
    );

    assert.deepEqual(bound, {
        estimatedActionScore: 10,
        remainingParcelScore: 1,
        totalScore: 11,
    });
});

test("earliest-delivery bounds decay uncollected parcels by unavoidable work", () => {
    const context = OptionPruningFixture.context();
    const bound = new EarliestDeliveryRewardBranchBoundEstimator().estimate(
        context,
        {
            actionType: DESIRE_TYPE.PICK_UP,
            positionAfterAction: new Position(1, 0),
            carriedParcelIdsAfterAction: ["nearby"],
            remainingParcelIds: ["distant"],
            elapsedMillisecondsAfterAction: 300,
            realizedDeliveryScore: 0,
            deliveryCellCandidates: context.deliveringCells,
        },
    );

    assert.deepEqual(bound, {
        estimatedActionScore: 10,
        remainingParcelScore: 0,
        totalScore: 10,
    });
});

test("the evaluator prunes a branch whose bound cannot beat the incumbent", () => {
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
        evaluation.bestSequence.map((desire): string => desire.identity()),
        ["pick:nearby", "drop:2,0"],
    );
    assert.equal(evaluation.graph.bestScore, 10);
    assert.deepEqual(
        evaluation.bestSequence.map((desire): string => desire.identity()),
        exhaustiveEvaluation.bestSequence.map(
            (desire): string => desire.identity(),
        ),
    );
    assert.equal(
        evaluation.graph.bestScore,
        exhaustiveEvaluation.graph.bestScore,
    );
    assert.ok(
        evaluation.graph.nodes.length < exhaustiveEvaluation.graph.nodes.length,
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

    const svg = new BranchAndBoundSvgRenderer().render(evaluation.graph, {
        agentId: context.agentId,
        cycle: 1,
        pass: 1,
    });
    assert.match(svg, /PRUNED/);
    assert.match(svg, /upper bound 2\.000/);
});

test("earliest-delivery bounds visit fewer nodes than immediate-reward bounds", () => {
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
        evaluation.bestSequence.map((desire): string => desire.identity()),
        exhaustiveEvaluation.bestSequence.map(
            (desire): string => desire.identity(),
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
});
