/** Regression tests for delivery-first scoring and path-length caching. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { DeliverParcelIntention, PickUpParcelIntention, } from "./intentions.js";
import { Action, ActionFactory, } from "./move.js";
import { Position } from "./position.js";
/** No-op action used to represent one path step in tests. */
class TestAction extends Action {
    /** Completes without interacting with a server. */
    async execute() { }
}
/** Open-grid pathfinder that records actual path searches. */
class CountingManhattanPathfinder extends BasePathfinder {
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
/** Creates complete parcel fixtures. */
class ParcelFixtureFactory {
    /** Builds one parcel with deterministic state. */
    static make(id, position, reward, carriedBy) {
        return {
            id,
            x: position.x,
            y: position.y,
            reward,
            carriedBy,
            lastUpdate: new Date(0),
        };
    }
}
/** Creates complete intention contexts. */
class IntentionContextFactory {
    /** Builds a context sharing the supplied pathfinder cache. */
    static make(agentPosition, parcels, deliveringCells, pathfinder) {
        const beliefs = new Beliefs();
        return {
            gameMap: [],
            agentPosition,
            crates: new Map(),
            pickupCells: [],
            deliveringCells,
            parcels,
            movementDuration: 1000,
            freeParcelsCount: 0,
            agentId: "agent",
            pathfinder,
            actionFactory: new ActionFactory(new TestGameClient(), beliefs),
        };
    }
}
test("path lengths are cached as directed routes until the cache is cleared", () => {
    const pathfinder = new CountingManhattanPathfinder();
    const first = new Position(0, 0);
    const second = new Position(5, 0);
    const crates = new Map();
    assert.equal(pathfinder.pathLength([], first, second, crates), 5);
    assert.equal(pathfinder.pathLength([], first, second, crates), 5);
    assert.equal(pathfinder.findPathCalls, 1);
    assert.equal(pathfinder.pathLength([], second, first, crates), 5);
    assert.equal(pathfinder.findPathCalls, 2);
    pathfinder.clearPathLengthCache();
    assert.equal(pathfinder.pathLength([], first, second, crates), 5);
    assert.equal(pathfinder.findPathCalls, 3);
});
test("pickup-first and delivery-first scoring reuse every repeated route", () => {
    const pathfinder = new CountingManhattanPathfinder();
    const agentPosition = new Position(0, 0);
    const firstDelivery = new Position(1, 0);
    const secondDelivery = new Position(0, 2);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 20, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 30, undefined);
    const context = IntentionContextFactory.make(agentPosition, new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]), [firstDelivery, secondDelivery], pathfinder);
    const freeParcelIds = new Set([candidateParcel.id]);
    new DeliverParcelIntention(firstDelivery, freeParcelIds).score(context);
    new DeliverParcelIntention(secondDelivery, freeParcelIds).score(context);
    new PickUpParcelIntention(candidateParcel, candidatePosition).score(context);
    assert.equal(pathfinder.findPathCalls, 7);
});
test("delivery first still wins when its drop zone lies on the parcel route", () => {
    const pathfinder = new CountingManhattanPathfinder();
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 20, undefined);
    const context = IntentionContextFactory.make(agentPosition, new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]), [deliveryCell], pathfinder);
    const pickupFirstScore = new PickUpParcelIntention(candidateParcel, candidatePosition).score(context);
    const deliveryFirstScore = new DeliverParcelIntention(deliveryCell, new Set([candidateParcel.id])).score(context);
    assert.equal(pickupFirstScore, 12);
    assert.equal(deliveryFirstScore, 20);
});
//# sourceMappingURL=_delivery-first.test.js.map