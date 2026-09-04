import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs } from "./bdi/beliefs.js";
import { DeliverParcelsDesire, DesireGenerator, VisitCellDesire, } from "./bdi/desires.js";
import { OptionEvaluator } from "./bdi/option_evaluator.js";
import { AdditiveDeliveryScoreModifier, DELIVERY_PARCEL_REWARD_ELIGIBILITY, DeliveryCellEffect, MultiplicativeDeliveryScoreModifier, } from "./_delivery-scoring.js";
import { CellScoreEffect } from "./utils/_cell-score-effects.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory } from "./utils/move.js";
import { Position } from "./utils/position.js";
import { drop_at, get_extreme_tile } from "./llm/tools/tools.js";
/** Typed fixtures for move-to mission planning tests. */
class MoveToMissionTestFixture {
    static gameClient() {
        return {
            async emitMove() {
                return { x: 0, y: 0 };
            },
            async emitPickup() {
                return [];
            },
            async emitPutdown() {
                return [];
            },
            async emitSay() {
                return "successful";
            },
        };
    }
    static context(options = {}) {
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(MoveToMissionTestFixture.gameClient(), beliefs);
        return {
            gameMap: MoveToMissionTestFixture.openMap(),
            agentPosition: new Position(1, 0),
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: options.deliveringCells ?? [],
            parcels: options.parcels ?? new Map(),
            pickupExcludedParcelIds: new Set(),
            sensedAgents: new Map(),
            movementDuration: 100,
            frameDuration: 100,
            observationDistance: 1,
            rewardDecayInterval: undefined,
            millisecondsUntilNextRewardDecay: undefined,
            agentId: "agent",
            pathfinder: new AStarPathfinder(actionFactory),
            actionFactory,
            cellScoreEffects: options.cellScoreEffects ?? [],
            deliveryScoreEffects: options.deliveryScoreEffects ?? [],
        };
    }
    static openMap() {
        return new GameMap([
            ["1", "1", "1"],
            ["1", "1", "1"],
            ["1", "1", "1"],
        ]);
    }
}
test("weighted A* avoids a malus when the detour costs less", () => {
    const context = MoveToMissionTestFixture.context({
        cellScoreEffects: [
            new CellScoreEffect("malus", new Position(1, 1), -10),
        ],
    });
    const route = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, new Position(1, 2), context.crates, context.cellScoreEffects);
    assert.equal(route.movementSteps, 4);
    assert.equal(route.routingCost, 4);
    assert.equal(route.cellScore, 0);
    assert.equal(route.positions.some((position) => position.isEqual(new Position(1, 1))), false);
});
test("weighted A* detours through a sufficiently valuable bonus", () => {
    const context = MoveToMissionTestFixture.context({
        cellScoreEffects: [
            new CellScoreEffect("bonus", new Position(0, 1), 10),
        ],
    });
    const route = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, new Position(1, 2), context.crates, context.cellScoreEffects);
    assert.equal(route.movementSteps, 4);
    assert.equal(route.routingCost, -6);
    assert.equal(route.cellScore, 10);
    assert.deepEqual(route.triggeredCellEffectIds, ["bonus"]);
});
test("positive move-to missions are standalone visit desires", () => {
    const context = MoveToMissionTestFixture.context({
        cellScoreEffects: [
            new CellScoreEffect("bonus", new Position(1, 2), 5),
        ],
    });
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    assert.equal(evaluation.bestSequence.length, 1);
    assert.equal(evaluation.bestSequence[0] instanceof VisitCellDesire, true);
    assert.equal(evaluation.graph.bestScore, 5);
    assert.equal(evaluation.graph.edges[0]?.optionType, "visit");
    assert.equal(evaluation.graph.edges[0]?.realizedCellScore, 5);
});
test("drop-at accepts white cells as well as regular delivery cells", () => {
    const deliveryCell = new Position(1, 2);
    const context = MoveToMissionTestFixture.context({
        deliveringCells: [deliveryCell],
    });
    assert.equal(drop_at(context, 1, 1, 10).isValid, true);
    assert.equal(drop_at(context, deliveryCell.x, deliveryCell.y, 10).isValid, true);
    assert.equal(drop_at(context, 3, 3, 10).isValid, false);
});
test("extreme-tile lookup resolves all four map directions", () => {
    const context = MoveToMissionTestFixture.context();
    context.gameMap.getTiles()[0] = ["0", "1", "0"];
    context.gameMap.getTiles()[2] = ["0", "0", "1"];
    assert.equal(get_extreme_tile(context, "leftmost")?.isEqual(new Position(0, 1)), true);
    assert.equal(get_extreme_tile(context, "rightmost")?.isEqual(new Position(2, 2)), true);
    assert.equal(get_extreme_tile(context, "downmost")?.isEqual(new Position(1, 0)), true);
    assert.equal(get_extreme_tile(context, "topmost")?.isEqual(new Position(1, 2)), true);
});
test("white drop-at mission cells become delivery candidates", () => {
    const whiteMissionCell = new Position(1, 2);
    const deliveryEffect = new DeliveryCellEffect("white-drop-bonus", whiteMissionCell, new AdditiveDeliveryScoreModifier(5));
    const parcel = {
        id: "parcel",
        x: 1,
        y: 0,
        carriedBy: "agent",
        reward: 20,
        lastUpdate: new Date(),
    };
    const context = MoveToMissionTestFixture.context({
        deliveringCells: [new Position(1, 0)],
        deliveryScoreEffects: [deliveryEffect],
        parcels: new Map([[parcel.id, parcel]]),
    });
    const generation = new DesireGenerator().generate(context);
    assert.equal(generation.deliveryCellCandidates.some((candidate) => candidate.cell.isEqual(whiteMissionCell)), true);
    assert.equal(generation.deliveryCellCandidates.find((candidate) => candidate.cell.isEqual(whiteMissionCell))?.parcelRewardEligibility, DELIVERY_PARCEL_REWARD_ELIGIBILITY.MISSION_ONLY);
});
test("white drop-at cells award mission points but no parcel score", () => {
    const regularDeliveryCell = new Position(1, 0);
    const whiteMissionCell = new Position(1, 2);
    const deliveryEffect = new DeliveryCellEffect("white-drop-bonus", whiteMissionCell, new AdditiveDeliveryScoreModifier(500));
    const parcels = new Map([11, 15].map((reward, index) => {
        const parcel = {
            id: `parcel-${index}`,
            x: regularDeliveryCell.x,
            y: regularDeliveryCell.y,
            carriedBy: "agent",
            reward,
            lastUpdate: new Date(),
        };
        return [parcel.id, parcel];
    }));
    const context = MoveToMissionTestFixture.context({
        deliveringCells: [regularDeliveryCell],
        deliveryScoreEffects: [deliveryEffect],
        parcels,
    });
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const selectedEdge = evaluation.graph.edges.find((edge) => edge.decision === "selected");
    assert.equal(evaluation.bestSequence[0]?.targetCell.isEqual(whiteMissionCell), true);
    assert.equal(evaluation.graph.bestScore, 500);
    assert.equal(selectedEdge?.realizedDeliveryScore, 500);
    assert.equal(selectedEdge?.realizedDeliveryMissionScore, 500);
});
test("drop-at mission cells are included once and modify delivery score", () => {
    const nearestDeliveryCell = new Position(1, 0);
    const missionDeliveryCell = new Position(1, 2);
    const deliveryEffect = new DeliveryCellEffect("drop-bonus", missionDeliveryCell, new AdditiveDeliveryScoreModifier(10));
    const parcel = {
        id: "parcel",
        x: 1,
        y: 0,
        carriedBy: "agent",
        reward: 20,
        lastUpdate: new Date(),
    };
    const context = MoveToMissionTestFixture.context({
        deliveringCells: [nearestDeliveryCell, missionDeliveryCell],
        deliveryScoreEffects: [deliveryEffect],
        parcels: new Map([[parcel.id, parcel]]),
    });
    const generator = new DesireGenerator();
    const generation = generator.generate(context);
    const matchingCandidates = generation.deliveryCellCandidates.filter((candidate) => candidate.cell.isEqual(missionDeliveryCell));
    const evaluation = new OptionEvaluator(generator).evaluateWithGraph(context);
    const selectedDesire = evaluation.bestSequence[0];
    const selectedEdge = evaluation.graph.edges.find((edge) => edge.optionIdentity === "drop:1,2");
    assert.equal(matchingCandidates.length, 1);
    assert.equal(matchingCandidates[0]?.effects.length, 1);
    assert.equal(selectedDesire instanceof DeliverParcelsDesire, true);
    assert.equal(selectedDesire?.targetCell.isEqual(missionDeliveryCell), true);
    assert.equal(evaluation.graph.bestScore, 30);
    assert.equal(selectedEdge?.realizedDeliveryScore, 30);
    assert.equal(selectedEdge?.realizedDeliveryMissionScore, 10);
});
test("delivery modifiers preserve penalty and multiplier semantics", () => {
    const context = { parcelScores: [25] };
    assert.equal(new AdditiveDeliveryScoreModifier(-10).apply(25, context), 15);
    assert.equal(new MultiplicativeDeliveryScoreModifier(0.5).apply(25, context), 12.5);
    assert.equal(new MultiplicativeDeliveryScoreModifier(2).apply(25, context), 50);
});
//# sourceMappingURL=_move-to-mission.spec.js.map