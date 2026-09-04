import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs, type Parcel } from "./bdi/beliefs.js";
import { DesireGenerator } from "./bdi/desires.js";
import { OptionEvaluator } from "./bdi/option_evaluator.js";
import { SCORE_EFFECT_LIFETIME } from "./_score-effect-lifetime.js";
import { GridFormationMission, RendezvousMission } from "./llm/mission.js";
import {
    GRID_COORDINATE_PARITY,
    GridPositionObjective,
    ReachableGridPositionSelector,
} from "./llm/tools/rendezvous/index.js";
import { MissionHandler } from "./llm/MissionHandler.js";
import { LLMClient, type LLMMessage } from "./llm/LLMClient.js";
import type { PlanningContext } from "./planning.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory, type GameClient } from "./utils/move.js";
import { Position } from "./utils/position.js";
import { CellScoreEffect } from "./utils/_cell-score-effects.js";

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

test("level-3 parsing accepts an odd-row formation", async (): Promise<void> => {
    const handler = LevelThreeJsonTestFixture.handler(JSON.stringify({
        tools: [{
            name: "plan_grid_formation",
            params: [
                { x: null, y: "odd" },
                { x: null, y: "odd" },
                700,
            ],
        }],
    }));
    handler.addPendingMission("sender", "control", "odd rows");

    const missions = await handler.evaluateMission(
        LevelThreeJsonTestFixture.context(),
    );

    assert.equal(missions.length, 1);
    assert.equal(missions[0] instanceof GridFormationMission, true);
    const formation = missions[0] as GridFormationMission;
    assert.equal(formation.reward, 700);
    assert.deepEqual(formation.llmAgentObjective.describe(), {
        x: null,
        y: "odd",
    });
});

test("level-3 parsing rejects unknown grid predicates", async (): Promise<void> => {
    const handler = LevelThreeJsonTestFixture.handler(JSON.stringify({
        tools: [{
            name: "plan_grid_formation",
            params: [
                { x: null, y: "prime" },
                { x: null, y: "odd" },
                700,
            ],
        }],
    }));
    handler.addPendingMission("sender", "control", "invalid formation");

    const missions = await handler.evaluateMission(
        LevelThreeJsonTestFixture.context(),
    );

    assert.deepEqual(missions, []);
});

test("grid position selection covers exact, parity, and wildcard axes", (): void => {
    const context = LevelThreeJsonTestFixture.context();
    const selector = new ReachableGridPositionSelector();

    assert.equal(
        selector.select(
            context,
            new GridPositionObjective(
                GRID_COORDINATE_PARITY.EVEN,
                undefined,
            ),
        )?.isEqual(new Position(0, 0)),
        true,
    );
    assert.equal(
        selector.select(
            context,
            new GridPositionObjective(1, GRID_COORDINATE_PARITY.ODD),
        )?.isEqual(new Position(1, 1)),
        true,
    );
    assert.equal(
        selector.select(
            context,
            new GridPositionObjective(undefined, undefined),
            [context.agentPosition],
        )?.isEqual(new Position(0, 1)),
        true,
    );
});

test("uncommitted formation rewards require their explicit visit option", (): void => {
    const baseContext = LevelThreeJsonTestFixture.context();
    const formationEffect = new CellScoreEffect(
        "grid-formation:mission-1:llm",
        new Position(0, 1),
        700,
        SCORE_EFFECT_LIFETIME.ONE_SHOT,
        true,
    );
    const parcel: Parcel = {
        id: "parcel",
        x: 0,
        y: 2,
        reward: 100,
        lastUpdate: new Date(),
    };
    const evaluation = new OptionEvaluator(new DesireGenerator())
        .evaluateWithGraph({
            ...baseContext,
            parcels: new Map<string, Parcel>([[parcel.id, parcel]]),
            cellScoreEffects: [formationEffect],
        });
    const pickupEdge = evaluation.graph.edges.find(
        (edge): boolean => edge.optionIdentity === "pick:parcel"
            && edge.sourceNodeId === evaluation.graph.rootNodeId,
    );
    const formationEdge = evaluation.graph.edges.find(
        (edge): boolean =>
            edge.optionIdentity
                === `visit:${formationEffect.id}`
            && edge.sourceNodeId === evaluation.graph.rootNodeId,
    );

    assert.equal(pickupEdge?.realizedCellScore, 0);
    assert.equal(formationEdge?.realizedCellScore, 700);
});

test("a formation can be selected when its closest cell is current", (): void => {
    const baseContext = LevelThreeJsonTestFixture.context();
    const formationEffect = new CellScoreEffect(
        "grid-formation:mission-current:llm",
        baseContext.agentPosition,
        700,
        SCORE_EFFECT_LIFETIME.ONE_SHOT,
        true,
    );
    const evaluation = new OptionEvaluator(new DesireGenerator())
        .evaluateWithGraph({
            ...baseContext,
            cellScoreEffects: [formationEffect],
        });

    assert.equal(
        evaluation.bestSequence[0]?.identity(),
        `visit:${formationEffect.id}`,
    );
    assert.equal(evaluation.graph.bestScore, 700);
});
