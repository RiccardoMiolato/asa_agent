/** Behavioral tests for cluster-aware search coverage and resumption. */
import assert from "node:assert/strict";
import test from "node:test";
import { AStarPathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { SearchIntention } from "./intentions.js";
import { ActionFactory, } from "./move.js";
import { Position } from "./position.js";
/** Records every authoritative position reached by movement actions. */
class RecordingGameClient {
    constructor(startingPosition) {
        this.position = startingPosition;
        this.visitedPositions = [startingPosition];
    }
    async emitMove(direction) {
        const offsets = {
            up: [0, 1],
            down: [0, -1],
            right: [1, 0],
            left: [-1, 0],
        };
        const [xOffset, yOffset] = offsets[direction];
        this.position = new Position(this.position.x + xOffset, this.position.y + yOffset);
        this.visitedPositions.push(this.position);
        return { x: this.position.x, y: this.position.y };
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown(_selected) {
        return [];
    }
}
/** Provides a fully typed intention context backed by the real A* pathfinder. */
class SearchIntentionScenario {
    constructor(startingPosition) {
        const beliefs = new Beliefs();
        this.client = new RecordingGameClient(startingPosition);
        this.actionFactory = new ActionFactory(this.client, beliefs);
        this.pathfinder = new AStarPathfinder(this.actionFactory);
    }
    makeContext(gameMap, pickupCells, observationDistance, pickupCellLastObservedAt = new Map(), parcels = new Map()) {
        let freeParcelsCount = 0;
        for (const parcel of parcels.values()) {
            if (!parcel.carriedBy) {
                freeParcelsCount += 1;
            }
        }
        return {
            gameMap,
            agentPosition: this.client.position,
            crates: new Map(),
            pickupCells,
            pickupCellLastObservedAt,
            deliveringCells: [],
            parcels,
            movementDuration: 0,
            frameDuration: 0,
            observationDistance,
            millisecondsUntilNextRewardDecay: undefined,
            freeParcelsCount,
            agentId: "test-agent",
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
        };
    }
    async execute(actions) {
        for (const action of actions) {
            await action.execute();
        }
    }
}
test("beliefs checkpoint pickup cells covered by sensing positions", () => {
    const beliefs = new Beliefs();
    beliefs.configPhase({
        CLOCK: 50,
        GAME: {
            map: { tiles: [["1"], ["3"]] },
            player: {
                movement_duration: 100,
                observation_distance: 1,
            },
        },
    });
    beliefs.revise([], [], [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    assert.ok(beliefs.pickupCellObservationTimes().has("0,0"));
    assert.equal(beliefs.pickupCellObservationTimes().has("1,0"), false);
});
test("search route observes every pickup cell in a rectangular cluster", async () => {
    const gameMap = Array.from({ length: 12 }, () => Array(10).fill("1"));
    const pickupCells = [];
    for (let x = 0; x < gameMap.length; x++) {
        for (let y = 0; y < gameMap[0].length; y++) {
            pickupCells.push(new Position(x, y));
        }
    }
    const scenario = new SearchIntentionScenario(new Position(0, 0));
    const search = new SearchIntention();
    const observationDistance = 2;
    const actions = search.buildActions(scenario.makeContext(gameMap, pickupCells, observationDistance));
    await scenario.execute(actions);
    const uncoveredCells = pickupCells.filter((cell) => !scenario.client.visitedPositions.some((visited) => visited.distanceTo(cell)
        <= observationDistance));
    assert.equal(uncoveredCells.length, 0);
});
test("completed search rotates to the cluster not yet visited", async () => {
    const gameMap = Array.from({ length: 12 }, () => Array(3).fill("3"));
    const pickupCells = [
        new Position(0, 0),
        new Position(0, 1),
        new Position(1, 0),
        new Position(1, 1),
        new Position(10, 1),
        new Position(10, 2),
        new Position(11, 1),
        new Position(11, 2),
    ];
    for (const cell of pickupCells) {
        gameMap[cell.x][cell.y] = "1";
    }
    const scenario = new SearchIntentionScenario(new Position(0, 0));
    const search = new SearchIntention();
    const firstContext = scenario.makeContext(gameMap, pickupCells, 1);
    await scenario.execute(search.buildActions(firstContext));
    search.onPlanCompleted(scenario.makeContext(gameMap, pickupCells, 1));
    search.buildActions(scenario.makeContext(gameMap, pickupCells, 1));
    const secondTarget = search.describe().target;
    assert.ok(secondTarget);
    assert.ok(secondTarget.x >= 10);
});
test("interrupted search resumes with only cells missing from its checkpoint", async () => {
    const gameMap = Array.from({ length: 8 }, () => ["1"]);
    const pickupCells = gameMap.map((_column, x) => new Position(x, 0));
    const scenario = new SearchIntentionScenario(new Position(0, 0));
    const search = new SearchIntention();
    const initialActions = search.buildActions(scenario.makeContext(gameMap, pickupCells, 0));
    await scenario.execute(initialActions.slice(0, 3));
    const observationTimes = new Map(scenario.client.visitedPositions.map((position) => [
        `${position.x},${position.y}`,
        Number.MAX_SAFE_INTEGER,
    ]));
    const resumedActions = search.buildActions(scenario.makeContext(gameMap, pickupCells, 0, observationTimes));
    await scenario.execute(resumedActions);
    assert.ok(resumedActions.length < initialActions.length);
    assert.equal(scenario.client.position.x, 7);
    assert.equal(scenario.client.position.y, 0);
});
test("known non-viable parcel does not make search interrupt itself", () => {
    const gameMap = [["1"], ["1"]];
    const pickupCells = [new Position(0, 0), new Position(1, 0)];
    const knownParcel = {
        id: "known",
        x: 0,
        y: 0,
        reward: 31,
        lastUpdate: new Date(),
    };
    const knownParcels = new Map([[knownParcel.id, knownParcel]]);
    const scenario = new SearchIntentionScenario(new Position(0, 0));
    const search = new SearchIntention();
    const plannedContext = scenario.makeContext(gameMap, pickupCells, 0, new Map(), knownParcels);
    const actions = search.buildActions(plannedContext);
    assert.ok(actions.length > 0);
    assert.equal(search.shouldInterrupt(plannedContext), false);
    const newParcel = {
        id: "new",
        x: 1,
        y: 0,
        reward: 31,
        lastUpdate: new Date(),
    };
    const updatedParcels = new Map(knownParcels);
    updatedParcels.set(newParcel.id, newParcel);
    const updatedContext = scenario.makeContext(gameMap, pickupCells, 0, new Map(), updatedParcels);
    assert.equal(search.shouldInterrupt(updatedContext), true);
});
//# sourceMappingURL=_search-intention.test.js.map