/** Regression tests for search recovery around temporary navigation walls. */
import assert from "node:assert/strict";
import test from "node:test";
import { AStarPathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { SearchIntention } from "./intentions.js";
import { ActionFactory } from "./move.js";
import { Position } from "./position.js";
/** Minimal client used to construct real movement actions for pathfinding. */
class SearchRecoveryGameClient {
    async emitMove(_direction) {
        return false;
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown(_selected) {
        return [];
    }
}
/** Builds a fully typed search context for a one-dimensional map. */
class SearchRecoveryScenario {
    constructor() {
        this.beliefs = new Beliefs();
        this.actionFactory = new ActionFactory(new SearchRecoveryGameClient(), this.beliefs);
        this.pathfinder = new AStarPathfinder(this.actionFactory);
    }
    makeContext(gameMap = [["1"], ["1"], ["1"], ["0"]], pickupCells = [
        new Position(0, 0),
        new Position(1, 0),
        new Position(2, 0),
        new Position(3, 0),
    ]) {
        return {
            gameMap,
            agentPosition: new Position(0, 0),
            crates: new Map(),
            pickupCells,
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [],
            parcels: new Map(),
            movementDuration: 0,
            frameDuration: 0,
            observationDistance: 0,
            rewardDecayInterval: undefined,
            millisecondsUntilNextRewardDecay: undefined,
            freeParcelsCount: 0,
            agentId: "test-agent",
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
        };
    }
}
test("search keeps reachable progress when a temporary wall blocks full coverage", () => {
    const search = new SearchIntention();
    const actions = search.buildActions(new SearchRecoveryScenario().makeContext());
    assert.equal(actions.length, 2);
    assert.deepEqual(search.describe().target, new Position(2, 0));
});
test("search prefers a complete cluster over partial progress", () => {
    const gameMap = Array.from({ length: 5 }, () => Array(3).fill("3"));
    gameMap[2][0] = "0";
    const pickupCells = [
        new Position(0, 0),
        new Position(1, 0),
        new Position(2, 0),
        new Position(4, 2),
    ];
    const search = new SearchIntention();
    const actions = search.buildActions(new SearchRecoveryScenario().makeContext(gameMap, pickupCells));
    assert.ok(actions.length > 0);
    assert.deepEqual(search.describe().target, new Position(4, 2));
});
test("search exposes no target when every cluster is temporarily blocked", () => {
    const search = new SearchIntention();
    const context = new SearchRecoveryScenario().makeContext([["1"], ["0"]], [new Position(0, 0), new Position(1, 0)]);
    const actions = search.buildActions(context);
    assert.equal(actions.length, 0);
    assert.equal(search.describe().target, undefined);
    assert.equal(search.isSatisfied(context), false);
});
//# sourceMappingURL=_search-recovery.test.js.map