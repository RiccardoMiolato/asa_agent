import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs } from "./bdi/beliefs.js";
import { DeliverParcelsDesire, DesireGenerator, } from "./bdi/desires.js";
import { OptionEvaluator } from "./bdi/option_evaluator.js";
import { AdditiveDeliveryScoreModifier, DELIVERY_CANDIDATE_SELECTION_REASON, DeliveryCandidateFactory, DeliveryCellEffect, ExactStackSizeDeliveryScoreModifier, GlobalDeliveryScoreEffect, MultiplicativeDeliveryScoreModifier, ParcelScoreThresholdDeliveryScoreModifier, } from "./_delivery-scoring.js";
import { BranchAndBoundSvgRenderer } from "./_branch-and-bound-svg.js";
import { DeliveryTimingOptimizer } from "./_delivery-timing.js";
import { SCORE_EFFECT_LIFETIME } from "./_score-effect-lifetime.js";
import { MissionHandler } from "./llm/MissionHandler.js";
import { LLMClient } from "./llm/LLMClient.js";
import { avoid_cell, } from "./llm/tools/tools.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory, } from "./utils/move.js";
import { Position } from "./utils/position.js";
/** Deterministic LLM adapter returning one prepared response per call. */
class SequenceLLMClient extends LLMClient {
    constructor(responses) {
        super("test-model", "http://unused.test", "unused", 100);
        this.responses = responses;
    }
    async callLLM(_messages, _systemPrompt) {
        return this.responses.shift() ?? "";
    }
}
/** Typed fixtures for persistent level-2 mission tests. */
class LevelTwoMissionTestFixture {
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
    static context(deliveryScoreEffects = [], parcels = new Map()) {
        const gameClient = LevelTwoMissionTestFixture.gameClient();
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(gameClient, beliefs);
        return {
            gameMap: new GameMap([
                ["2", "1", "1"],
                ["1", "1", "1"],
                ["1", "1", "2"],
            ]),
            agentPosition: new Position(1, 0),
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [new Position(0, 0), new Position(2, 2)],
            parcels,
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
            cellScoreEffects: [],
            deliveryScoreEffects,
        };
    }
    static missionHandler(responses = []) {
        return new MissionHandler(LevelTwoMissionTestFixture.gameClient(), new SequenceLLMClient(responses));
    }
}
test("exact-stack modifiers apply only to the configured stack size", () => {
    const doubleThree = new GlobalDeliveryScoreEffect("stack-three", new ExactStackSizeDeliveryScoreModifier(3, 2), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const thirtyPercentFive = new GlobalDeliveryScoreEffect("stack-five", new ExactStackSizeDeliveryScoreModifier(5, 0.3), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const threeCandidate = DeliveryCandidateFactory.make(new Position(0, 0), [doubleThree]);
    const fiveCandidate = DeliveryCandidateFactory.make(new Position(0, 0), [thirtyPercentFive]);
    assert.equal(threeCandidate.adjustedScore(30, [10, 10, 10], new Set(["stack-three"])), 60);
    assert.equal(threeCandidate.adjustedScore(20, [10, 10], new Set(["stack-three"])), 20);
    assert.equal(fiveCandidate.adjustedScore(50, [10, 10, 10, 10, 10], new Set(["stack-five"])), 15);
});
test("persistent stack bonuses apply to multiple simulated deliveries", () => {
    const stackEffect = new GlobalDeliveryScoreEffect("stack-two", new ExactStackSizeDeliveryScoreModifier(2, 2), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const parcels = new Map();
    for (let index = 0; index < 4; index += 1) {
        const parcel = {
            id: `parcel-${index}`,
            x: 1,
            y: index % 3,
            reward: 10,
            carriedBy: undefined,
            lastUpdate: new Date(),
        };
        parcels.set(parcel.id, parcel);
    }
    const context = LevelTwoMissionTestFixture.context([stackEffect], parcels);
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const deliveryCount = evaluation.bestSequence.filter((desire) => desire.type === "drop").length;
    assert.equal(evaluation.graph.bestScore, 80);
    assert.equal(deliveryCount, 2);
});
test("an or mission creates two repeatable coordinate multipliers", async () => {
    const context = LevelTwoMissionTestFixture.context();
    const firstCell = new Position(0, 0);
    const secondCell = new Position(2, 2);
    const handler = LevelTwoMissionTestFixture.missionHandler([
        JSON.stringify({
            level: 2,
            worth: true,
            motivation: "persistent coordinate multipliers",
            requires_answer: false,
        }),
        JSON.stringify({
            tools: [
                {
                    name: "delivery_constraint",
                    params: [firstCell.x, firstCell.y, "multiplier", 5],
                },
                {
                    name: "delivery_constraint",
                    params: [secondCell.x, secondCell.y, "multiplier", 5],
                },
            ],
        }),
    ]);
    handler.addPendingMission("sender", "Mission Control", "Every time you deliver in (0,0) or (2,2), get 5x points");
    const missions = await handler.evaluateMission(context);
    assert.equal(missions.length, 2);
    assert.equal(handler.getActiveMission().length, 2);
    for (const cell of [firstCell, secondCell]) {
        const effects = handler.getActiveDeliveryScoreEffects();
        const candidate = DeliveryCandidateFactory.make(cell, effects);
        const activeIds = new Set(effects.map((effect) => effect.id));
        assert.equal(candidate.adjustedScore(10, [10], activeIds), 50);
        assert.deepEqual(candidate.consumedEffectIds(activeIds), []);
    }
    handler.completeDropAtMissionsAt(firstCell);
    assert.equal(handler.getActiveMission().length, 2);
    const remainingEffects = handler.getActiveDeliveryScoreEffects();
    assert.equal(DeliveryCandidateFactory.make(firstCell, remainingEffects).adjustedScore(10, [10], new Set(remainingEffects.map((effect) => effect.id))), 50);
});
test("a zero multiplier makes every delivery at its cell worth zero", () => {
    const zeroEffect = new DeliveryCellEffect("zero-cell", new Position(0, 0), new MultiplicativeDeliveryScoreModifier(0), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const candidate = DeliveryCandidateFactory.make(new Position(0, 0), [zeroEffect]);
    assert.equal(candidate.adjustedScore(25, [10, 15], new Set(["zero-cell"])), 0);
    assert.deepEqual(candidate.consumedEffectIds(new Set(["zero-cell"])), []);
});
test("an adjacent unpenalized delivery cell replaces the penalized candidate", () => {
    const penalizedCell = new Position(0, 0);
    const adjacentCell = new Position(0, 1);
    const penalty = new DeliveryCellEffect("penalized-drop", penalizedCell, new AdditiveDeliveryScoreModifier(-10), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const parcel = {
        id: "carried",
        x: 1,
        y: 0,
        reward: 20,
        carriedBy: "agent",
        lastUpdate: new Date(),
    };
    const context = {
        ...LevelTwoMissionTestFixture.context([penalty], new Map([[parcel.id, parcel]])),
        deliveringCells: [penalizedCell, adjacentCell],
    };
    const candidates = new DesireGenerator()
        .generate(context)
        .deliveryCellCandidates;
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.cell.isEqual(adjacentCell), true);
    assert.equal(candidates[0]?.selectionReason, DELIVERY_CANDIDATE_SELECTION_REASON.PENALTY_REPLACEMENT);
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const replacementEdge = evaluation.graph.edges.find((edge) => edge.targetPosition.isEqual(adjacentCell));
    const svg = new BranchAndBoundSvgRenderer().render(evaluation.graph, { agentId: context.agentId, cycle: 1, pass: 1 });
    assert.equal(replacementEdge?.isPenaltyReplacement, true);
    assert.match(svg, /class="replacement-halo"/);
    assert.match(svg, /penalty-replacement delivery cell/);
});
test("a non-adjacent alternative is added without removing the penalized candidate", () => {
    const penalizedCell = new Position(0, 0);
    const distantCell = new Position(2, 2);
    const penalty = new DeliveryCellEffect("penalized-drop", penalizedCell, new MultiplicativeDeliveryScoreModifier(0.5), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const parcel = {
        id: "carried",
        x: 1,
        y: 0,
        reward: 20,
        carriedBy: "agent",
        lastUpdate: new Date(),
    };
    const context = LevelTwoMissionTestFixture.context([penalty], new Map([[parcel.id, parcel]]));
    const candidates = new DesireGenerator()
        .generate(context)
        .deliveryCellCandidates;
    assert.equal(candidates.length, 2);
    assert.equal(candidates.some((candidate) => candidate.cell.isEqual(penalizedCell)), true);
    assert.equal(candidates.some((candidate) => candidate.cell.isEqual(distantCell)), true);
});
test("a penalized delivery cell outside the selected pool is not force-added", () => {
    const selectedCell = new Position(0, 0);
    const unselectedPenalizedCell = new Position(2, 2);
    const penalty = new DeliveryCellEffect("unselected-penalized-drop", unselectedPenalizedCell, new AdditiveDeliveryScoreModifier(-10), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const parcel = {
        id: "carried",
        x: 1,
        y: 0,
        reward: 20,
        carriedBy: "agent",
        lastUpdate: new Date(),
    };
    const context = LevelTwoMissionTestFixture.context([penalty], new Map([[parcel.id, parcel]]));
    const candidates = new DesireGenerator()
        .generate(context)
        .deliveryCellCandidates;
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.cell.isEqual(selectedCell), true);
    assert.equal(candidates.some((candidate) => candidate.cell.isEqual(unselectedPenalizedCell)), false);
});
test("parcel thresholds zero only disallowed parcel rewards", () => {
    const thresholdEffect = new GlobalDeliveryScoreEffect("threshold", new ParcelScoreThresholdDeliveryScoreModifier(10, true), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const candidate = DeliveryCandidateFactory.make(new Position(0, 0), [thresholdEffect]);
    assert.equal(candidate.adjustedScore(31, [5, 10, 16], new Set(["threshold"])), 15);
});
test("delivery timing evaluates threshold crossings and selects one second", () => {
    const thresholdEffect = new GlobalDeliveryScoreEffect("threshold-timing", new ParcelScoreThresholdDeliveryScoreModifier(10, true), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const candidate = DeliveryCandidateFactory.make(new Position(0, 0), [thresholdEffect]);
    const decision = DeliveryTimingOptimizer.maximizeScore(candidate, [10, 11, 50], 0, 1000, 1000, new Set(["threshold-timing"]));
    assert.deepEqual(decision.consideredWaitMilliseconds, [0, 1000, 40000]);
    assert.equal(decision.waitMilliseconds, 1000);
    assert.deepEqual(decision.parcelScores, [9, 10, 49]);
    assert.equal(decision.adjustedDeliveryScore, 19);
});
test("the evaluator propagates the optimal wait into the delivery desire", () => {
    const thresholdEffect = new GlobalDeliveryScoreEffect("threshold-plan", new ParcelScoreThresholdDeliveryScoreModifier(10, true), SCORE_EFFECT_LIFETIME.PERSISTENT);
    const deliveryCell = new Position(0, 0);
    const parcels = new Map([10, 11, 50].map((reward, index) => {
        const parcel = {
            id: `carried-${index}`,
            x: deliveryCell.x,
            y: deliveryCell.y,
            reward,
            carriedBy: "agent",
            lastUpdate: new Date(),
        };
        return [parcel.id, parcel];
    }));
    const context = {
        ...LevelTwoMissionTestFixture.context([thresholdEffect], parcels),
        agentPosition: deliveryCell,
        deliveringCells: [deliveryCell],
        movementDuration: 0,
        frameDuration: 0,
        rewardDecayInterval: 1000,
        millisecondsUntilNextRewardDecay: 1000,
    };
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const delivery = evaluation.bestSequence[0];
    const selectedEdge = evaluation.graph.edges.find((edge) => edge.decision === "selected");
    assert.equal(evaluation.graph.bestScore, 19);
    assert.ok(delivery instanceof DeliverParcelsDesire);
    assert.equal(delivery.waitMilliseconds, 1000);
    assert.equal(selectedEdge?.deliveryWaitMilliseconds, 1000);
    assert.equal(selectedEdge?.estimatedArrivalMilliseconds, 1000);
});
test("avoid-cell penalties remain active after reaching the cell", () => {
    const context = LevelTwoMissionTestFixture.context();
    const handler = LevelTwoMissionTestFixture.missionHandler();
    const avoidedCell = new Position(1, 1);
    handler.activateLevelTwoConstraints(context, [avoid_cell(avoidedCell.x, avoidedCell.y, -50)]);
    handler.completeMoveToMissionsAt(avoidedCell);
    const effects = handler.getActiveMoveToEffects();
    const firstRoute = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, new Position(1, 2), context.crates, effects);
    const secondRoute = context.pathfinder.findMovementPath(context.gameMap, context.agentPosition, new Position(1, 2), context.crates, effects);
    assert.equal(handler.getActiveMission().length, 1);
    assert.equal(firstRoute.movementSteps, 4);
    assert.equal(secondRoute.movementSteps, 4);
    assert.equal(firstRoute.positions.some((position) => position.isEqual(avoidedCell)), false);
});
//# sourceMappingURL=_level-two-mission.test.js.map