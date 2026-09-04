/** Regression tests for directed and symmetric path-length caching. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AStarPathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { Action, ActionFactory, } from "./move.js";
import { Position } from "./position.js";
/** No-op action used to represent one path step. */
class TestAction extends Action {
    /** Completes without interacting with a server. */
    async execute() { }
}
/** No-op client used only to construct the action factory. */
class TestGameClient {
    /** Returns a successful stationary move. */
    async emitMove(_direction) {
        return { x: 0, y: 0 };
    }
    /** Returns an empty pickup result. */
    async emitPickup() {
        return [];
    }
    /** Returns an empty put-down result. */
    async emitPutdown(_selected) {
        return [];
    }
}
/** A* pathfinder test double that records actual searches. */
class CountingAStarPathfinder extends AStarPathfinder {
    constructor() {
        super(...arguments);
        this.findPathCalls = 0;
    }
    /** Returns one no-op action per Manhattan-distance step. */
    findPath(_gameMap, startingPosition, targetPosition, _crates, _temporarilyLocked) {
        this.findPathCalls += 1;
        return Array.from({ length: startingPosition.distanceTo(targetPosition) }, () => new TestAction());
    }
}
/** Creates a pathfinder with all runtime dependencies satisfied. */
class PathfinderFixtureFactory {
    /** Builds a counting A* pathfinder. */
    static make() {
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(new TestGameClient(), beliefs);
        return new CountingAStarPathfinder(actionFactory);
    }
}
test("reverse paths share one cache entry on a symmetric map", () => {
    const pathfinder = PathfinderFixtureFactory.make();
    const gameMap = [["3"]];
    const first = new Position(0, 0);
    const second = new Position(5, 0);
    const crates = new Map();
    assert.equal(pathfinder.pathLength(gameMap, first, second, crates), 5);
    assert.equal(pathfinder.pathLength(gameMap, second, first, crates), 5);
    assert.equal(pathfinder.findPathCalls, 1);
});
test("reverse paths remain separate when the map has a directional tile", () => {
    const pathfinder = PathfinderFixtureFactory.make();
    const gameMap = [["→"]];
    const first = new Position(0, 0);
    const second = new Position(5, 0);
    const crates = new Map();
    assert.equal(pathfinder.pathLength(gameMap, first, second, crates), 5);
    assert.equal(pathfinder.pathLength(gameMap, second, first, crates), 5);
    assert.equal(pathfinder.findPathCalls, 2);
});
test("temporary-lock paths remain directed on a symmetric map", () => {
    const pathfinder = PathfinderFixtureFactory.make();
    const gameMap = [["3"]];
    const first = new Position(0, 0);
    const second = new Position(5, 0);
    const locked = new Position(3, 0);
    const crates = new Map();
    assert.equal(pathfinder.pathLength(gameMap, first, second, crates, locked), 5);
    assert.equal(pathfinder.pathLength(gameMap, second, first, crates, locked), 5);
    assert.equal(pathfinder.findPathCalls, 2);
});
//# sourceMappingURL=_path-length-cache.test.js.map