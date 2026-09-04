import assert from "node:assert/strict";
import test from "node:test";
import { AStarPathfinder } from "./astar.js";
import { PickUpParcelIntention, SearchIntention, } from "./intentions.js";
import { Action } from "./move.js";
import { Position } from "./position.js";
class NoopAction extends Action {
    async execute() {
        return true;
    }
}
const actionFactory = {
    moveUp: () => new NoopAction(),
    moveDown: () => new NoopAction(),
    moveRight: () => new NoopAction(),
    moveLeft: () => new NoopAction(),
    pickUp: () => new NoopAction(),
    drop: () => new NoopAction(),
};
function makeContext(overrides = {}) {
    return {
        gameMap: [["1", "5", "1", "2"]],
        agentPosition: new Position(0, 0),
        crates: new Map([["crate", new Position(0, 1)]]),
        pickupCells: [new Position(0, 2)],
        pickupCellLastObservedAt: new Map(),
        deliveringCells: [new Position(0, 3)],
        parcels: new Map(),
        movementDuration: 0,
        frameDuration: 0,
        observationDistance: 0,
        rewardDecayInterval: undefined,
        millisecondsUntilNextRewardDecay: undefined,
        freeParcelsCount: 0,
        agentId: "agent",
        pathfinder: new AStarPathfinder(actionFactory),
        actionFactory,
        ...overrides,
    };
}
test("a crate-blocked pickup remains eligible for PDDL planning", () => {
    const parcel = {
        id: "parcel",
        x: 0,
        y: 2,
        reward: 10,
        lastUpdate: new Date(),
    };
    const context = makeContext({
        parcels: new Map([[parcel.id, parcel]]),
        freeParcelsCount: 1,
    });
    const intention = new PickUpParcelIntention(parcel, new Position(0, 2));
    assert.equal(context.pathfinder.pathLength(context.gameMap, context.agentPosition, intention.parcelPosition, context.crates), undefined);
    assert.equal(intention.selectionDistance(context), 2);
    assert.ok(intention.score(context) > 0);
});
test("an already-covered search does not target the current position", () => {
    const currentPosition = new Position(0, 0);
    const intention = new SearchIntention();
    const context = makeContext({
        gameMap: [["1"]],
        agentPosition: currentPosition,
        crates: new Map(),
        pickupCells: [currentPosition],
        deliveringCells: [],
    });
    assert.deepEqual(intention.buildActions(context), []);
    assert.equal(intention.describe().target, undefined);
    assert.equal(intention.toPddlGoal(context), undefined);
});
test("a crate-blocked search exposes an optimistic target to PDDL", () => {
    const intention = new SearchIntention();
    const context = makeContext({
        gameMap: [["1", "5", "5", "1"]],
        agentPosition: new Position(0, 0),
        crates: new Map([["crate", new Position(0, 1)]]),
        pickupCells: [new Position(0, 3)],
        deliveringCells: [],
    });
    assert.deepEqual(intention.buildActions(context), []);
    assert.deepEqual(intention.describe().target, new Position(0, 3));
    assert.deepEqual(intention.toPddlGoal(context)?.finalTargetPosition, new Position(0, 3));
});
//# sourceMappingURL=_crate-planning.test.js.map