/** Regression tests for delivery-first intention scoring. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { IntentionGenerator } from "./desires.js";
import { DeliverParcelIntention, PickUpParcelIntention, } from "./intentions.js";
import { ActionFactory, } from "./move.js";
import { Position } from "./position.js";
/** Deterministic open-grid pathfinder used by route-scoring tests. */
class ManhattanPathfinder extends BasePathfinder {
    /** This test double exposes distances directly and never creates actions. */
    findPath(_gameMap, _startingPosition, _targetPosition, _crates, _temporarilyLocked) {
        return [];
    }
    /** Returns the unobstructed Manhattan distance between two positions. */
    pathLength(_gameMap, startingPosition, targetPosition, _crates, _temporarilyLocked) {
        return startingPosition.distanceTo(targetPosition);
    }
}
/** No-op game client used only to satisfy the action-factory contract. */
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
/** Creates typed parcel fixtures without exposing partially shaped objects. */
class ParcelFixtureFactory {
    /** Builds a complete parcel fixture. */
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
/** Creates the intention context shared by a single scoring test. */
class IntentionContextFactory {
    /** Builds an intention context with deterministic movement timing. */
    static make(agentPosition, parcels, deliveringCells) {
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
            pathfinder: new ManhattanPathfinder(),
            actionFactory: new ActionFactory(new TestGameClient(), beliefs),
        };
    }
}
test("delivery first includes the best parcel collected after delivery", () => {
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 20, undefined);
    const parcels = new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]);
    const context = IntentionContextFactory.make(agentPosition, parcels, [deliveryCell]);
    const pickupFirstScore = new PickUpParcelIntention(candidateParcel, candidatePosition).score(context);
    const deliveryFirstScore = new DeliverParcelIntention(deliveryCell, new Set([candidateParcel.id])).score(context);
    assert.equal(pickupFirstScore, 12);
    assert.equal(deliveryFirstScore, 20);
    assert.ok(deliveryFirstScore > pickupFirstScore);
});
test("delivery first has no continuation reward without a free parcel", () => {
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const context = IntentionContextFactory.make(agentPosition, new Map([[carriedParcel.id, carriedParcel]]), [deliveryCell]);
    assert.equal(new DeliverParcelIntention(deliveryCell, new Set()).score(context), 9);
});
test("delivery-first scoring can prefer a farther cell on the parcel route", () => {
    const agentPosition = new Position(0, 0);
    const nearestDelivery = new Position(0, 1);
    const onRouteDelivery = new Position(2, 0);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 20, undefined);
    const context = IntentionContextFactory.make(agentPosition, new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]), [nearestDelivery, onRouteDelivery]);
    const freeParcelIds = new Set([candidateParcel.id]);
    const nearestDeliveryScore = new DeliverParcelIntention(nearestDelivery, freeParcelIds).score(context);
    const onRouteDeliveryScore = new DeliverParcelIntention(onRouteDelivery, freeParcelIds).score(context);
    assert.equal(nearestDeliveryScore, 19);
    assert.equal(onRouteDeliveryScore, 20);
    assert.ok(onRouteDeliveryScore > nearestDeliveryScore);
});
test("the intention generator exposes every delivery-cell alternative", () => {
    const agentPosition = new Position(0, 0);
    const firstDelivery = new Position(0, 1);
    const secondDelivery = new Position(2, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const beliefs = new Beliefs();
    beliefs.parcels.set(carriedParcel.id, carriedParcel);
    beliefs.delivering_cells = [firstDelivery, secondDelivery];
    const intentions = new IntentionGenerator(beliefs).generate({
        id: "agent",
        position: agentPosition,
    });
    const deliveryIntentions = intentions.filter((intention) => intention instanceof DeliverParcelIntention);
    assert.deepEqual(deliveryIntentions.map((intention) => intention.deliveryCell), [firstDelivery, secondDelivery]);
});
test("a changed free-parcel set invalidates an active delivery plan", () => {
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const knownParcel = ParcelFixtureFactory.make("known", new Position(1, 0), 10, undefined);
    const newParcel = ParcelFixtureFactory.make("new", new Position(2, 0), 10, undefined);
    const intention = new DeliverParcelIntention(deliveryCell, new Set([knownParcel.id]));
    assert.equal(intention.shouldInterrupt(IntentionContextFactory.make(agentPosition, new Map([[knownParcel.id, knownParcel]]), [deliveryCell])), false);
    assert.equal(intention.shouldInterrupt(IntentionContextFactory.make(agentPosition, new Map([
        [knownParcel.id, knownParcel],
        [newParcel.id, newParcel],
    ]), [deliveryCell])), true);
});
//# sourceMappingURL=_delivery-first.test.js.map