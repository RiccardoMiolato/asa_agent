import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs } from "./bdi/beliefs.js";
import { RENDEZVOUS_PARTICIPANT, RendezvousMission, } from "./llm/mission.js";
import { MissionHandler } from "./llm/MissionHandler.js";
import { LLMClient } from "./llm/LLMClient.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory } from "./utils/move.js";
import { Position } from "./utils/position.js";
/** Deterministic LLM adapter returning one prepared response per call. */
class LevelThreeSequenceLLMClient extends LLMClient {
    constructor(responses) {
        super("test-model", "http://unused.test", "unused", 100);
        this.responses = responses;
    }
    async callLLM(_messages, _systemPrompt) {
        return this.responses.shift() ?? "";
    }
}
/** Typed fixtures for level-3 rendezvous planning tests. */
class LevelThreeMissionTestFixture {
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
    static context(gameMap, agentPosition, crates = new Map()) {
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(LevelThreeMissionTestFixture.gameClient(), beliefs);
        return {
            gameMap,
            agentPosition,
            crates,
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [],
            parcels: new Map(),
            movementDuration: 100,
            frameDuration: 100,
            observationDistance: 1,
            rewardDecayInterval: undefined,
            millisecondsUntilNextRewardDecay: undefined,
            agentId: "llm-agent",
            pathfinder: new AStarPathfinder(actionFactory),
            actionFactory,
            cellScoreEffects: [],
            deliveryScoreEffects: [],
        };
    }
    static handler(planningResponse) {
        return new MissionHandler(LevelThreeMissionTestFixture.gameClient(), new LevelThreeSequenceLLMClient([
            JSON.stringify({
                level: 3,
                worth: true,
                requires_answer: false,
            }),
            JSON.stringify(planningResponse),
        ]));
    }
    static openMap(size) {
        return new GameMap(Array.from({ length: size }, () => Array.from({ length: size }, () => "1")));
    }
}
test("a level-3 rendezvous selects two distinct safe assignments", async () => {
    const center = new Position(2, 2);
    const maximumDistance = 2;
    const crate = new Position(1, 1);
    const context = LevelThreeMissionTestFixture.context(LevelThreeMissionTestFixture.openMap(5), new Position(0, 0), new Map([["crate", crate]]));
    const handler = LevelThreeMissionTestFixture.handler({
        tools: [{
                name: "plan_rendezvous",
                params: [center.x, center.y, maximumDistance, 500],
            }],
    });
    handler.addPendingMission("mission-control", "Mission Control", "Move both agents near (2,2), at most 2 cells away, and wait for each other. Receive 500pts.");
    const missions = await handler.evaluateMission(context);
    assert.equal(missions.length, 1);
    assert.equal(missions[0] instanceof RendezvousMission, true);
    const mission = missions[0];
    const llmAssignment = mission.assignmentFor(RENDEZVOUS_PARTICIPANT.LLM_AGENT);
    const bdiAssignment = mission.assignmentFor(RENDEZVOUS_PARTICIPANT.BDI_AGENT);
    assert.equal(llmAssignment.target.isEqual(new Position(0, 2)), true);
    assert.equal(bdiAssignment.target.isEqual(center), true);
    assert.equal(llmAssignment.target.isEqual(bdiAssignment.target), false);
    for (const assignment of [llmAssignment, bdiAssignment]) {
        assert.equal(context.gameMap.isValidCell(assignment.target), true);
        assert.equal(assignment.target.distanceTo(center) <= maximumDistance, true);
        assert.equal(assignment.target.isEqual(crate), false);
    }
    assert.equal(mission.reward, 500);
    assert.equal(mission.getLevel(), 3);
    assert.equal(handler.getActiveMission().length, 1);
});
test("a planned rendezvous does not become an independent move reward", async () => {
    const context = LevelThreeMissionTestFixture.context(LevelThreeMissionTestFixture.openMap(3), new Position(0, 0));
    const handler = LevelThreeMissionTestFixture.handler({
        tools: [{
                name: "plan_rendezvous",
                params: [1, 1, 1, 500],
            }],
    });
    handler.addPendingMission("sender", "control", "rendezvous");
    await handler.evaluateMission(context);
    assert.deepEqual(handler.getActiveMoveToEffects(), []);
});
test("a rendezvous is rejected when fewer than two safe cells exist", async () => {
    const context = LevelThreeMissionTestFixture.context(new GameMap([["1"]]), new Position(0, 0));
    const handler = LevelThreeMissionTestFixture.handler({
        tools: [{
                name: "plan_rendezvous",
                params: [0, 0, 3, 500],
            }],
    });
    handler.addPendingMission("sender", "control", "rendezvous");
    const missions = await handler.evaluateMission(context);
    assert.deepEqual(missions, []);
    assert.deepEqual(handler.getActiveMission(), []);
});
test("malformed level-3 tool output is rejected at the boundary", async () => {
    const context = LevelThreeMissionTestFixture.context(LevelThreeMissionTestFixture.openMap(3), new Position(0, 0));
    const handler = LevelThreeMissionTestFixture.handler({
        tools: [{
                name: "plan_rendezvous",
                params: [1, 1, "three", 500],
            }],
    });
    handler.addPendingMission("sender", "control", "rendezvous");
    const missions = await handler.evaluateMission(context);
    assert.deepEqual(missions, []);
});
//# sourceMappingURL=_level-three-mission.spec.js.map