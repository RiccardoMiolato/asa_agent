import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs, type Parcel } from "./bdi/beliefs.js";
import { RendezvousMission } from "./llm/mission.js";
import { MissionHandler } from "./llm/MissionHandler.js";
import { LLMClient, type LLMMessage } from "./llm/LLMClient.js";
import type { PlanningContext } from "./planning.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory, type GameClient } from "./utils/move.js";
import { Position } from "./utils/position.js";

/** Deterministic LLM adapter for response-format regression tests. */
class JsonResponseLLMClient extends LLMClient {
    constructor(private readonly responses: string[]) {
        super("test-model", "http://unused.test", "unused", 100);
    }

    override async callLLM(
        _messages: LLMMessage[],
        _systemPrompt: string,
    ): Promise<string> {
        return this.responses.shift() ?? "";
    }
}

/** Typed fixture for evaluating one level-3 LLM response. */
class LevelThreeJsonTestFixture {
    static gameClient(): GameClient {
        return {
            async emitMove(): Promise<{ x: number; y: number } | false> {
                return { x: 0, y: 0 };
            },
            async emitPickup(): Promise<readonly []> {
                return [];
            },
            async emitPutdown(): Promise<readonly []> {
                return [];
            },
            async emitSay(): Promise<"successful"> {
                return "successful";
            },
        };
    }

    static context(): PlanningContext {
        const client = LevelThreeJsonTestFixture.gameClient();
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(client, beliefs);
        return {
            gameMap: new GameMap([
                ["1", "1", "1"],
                ["1", "1", "1"],
                ["1", "1", "1"],
            ]),
            agentPosition: new Position(0, 0),
            crates: new Map<string, Position>(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map<string, number>(),
            deliveringCells: [],
            parcels: new Map<string, Parcel>(),
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

    static handler(planningResponse: string): MissionHandler {
        return new MissionHandler(
            LevelThreeJsonTestFixture.gameClient(),
            new JsonResponseLLMClient([
                JSON.stringify({
                    level: 3,
                    worth: true,
                    requires_answer: false,
                }),
                planningResponse,
            ]),
        );
    }
}

test("level-3 parsing accepts one fenced JSON object", async (): Promise<void> => {
    const handler = LevelThreeJsonTestFixture.handler(`\`\`\`json
{"tools":[{"name":"plan_rendezvous","params":[1,1,1,500]}]}
\`\`\``);
    handler.addPendingMission("sender", "control", "rendezvous");

    const missions = await handler.evaluateMission(
        LevelThreeJsonTestFixture.context(),
    );

    assert.equal(missions.length, 1);
    assert.equal(missions[0] instanceof RendezvousMission, true);
});

test("level-3 parsing rejects prose around JSON", async (): Promise<void> => {
    const handler = LevelThreeJsonTestFixture.handler(
        'Here is the plan: {"tools":[]}',
    );
    handler.addPendingMission("sender", "control", "rendezvous");

    const missions = await handler.evaluateMission(
        LevelThreeJsonTestFixture.context(),
    );

    assert.deepEqual(missions, []);
});
