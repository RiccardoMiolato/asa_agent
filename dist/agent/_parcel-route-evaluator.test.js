/** Regression tests for parcel-route reward evaluation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ParcelRouteEvaluator, } from "./_parcel-route-evaluator.js";
import { BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { IntentionGenerator } from "./desires.js";
import { DeliverParcelIntention } from "./intentions.js";
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
/** Creates the route context shared by a single scoring test. */
class RouteContextFactory {
    /** Builds a route context with deterministic movement timing. */
    static make(parcels, deliveringCells) {
        return {
            gameMap: [],
            crates: new Map(),
            deliveringCells,
            parcels,
            movementDuration: 1000,
            agentId: "agent",
            pathfinder: new ManhattanPathfinder(),
        };
    }
}
test("delivery first includes the best parcel collected after delivery", () => {
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 20, undefined);
    const context = RouteContextFactory.make(new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]), [deliveryCell]);
    const pickupFirstScore = ParcelRouteEvaluator.scorePickupFirst(context, agentPosition, candidateParcel, candidatePosition);
    const deliveryFirstScore = ParcelRouteEvaluator.scoreDeliveryFirst(context, agentPosition, deliveryCell);
    assert.equal(pickupFirstScore, 12);
    assert.equal(deliveryFirstScore, 20);
    assert.ok(deliveryFirstScore > pickupFirstScore);
});
test("delivery first has no continuation reward without a free parcel", () => {
    const agentPosition = new Position(0, 0);
    const deliveryCell = new Position(1, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const context = RouteContextFactory.make(new Map([[carriedParcel.id, carriedParcel]]), [deliveryCell]);
    assert.equal(ParcelRouteEvaluator.scoreDeliveryFirst(context, agentPosition, deliveryCell), 9);
});
test("delivery-first scoring can prefer a farther cell on the parcel route", () => {
    const agentPosition = new Position(0, 0);
    const nearestDelivery = new Position(0, 1);
    const onRouteDelivery = new Position(2, 0);
    const candidatePosition = new Position(5, 0);
    const carriedParcel = ParcelFixtureFactory.make("carried", agentPosition, 10, "agent");
    const candidateParcel = ParcelFixtureFactory.make("candidate", candidatePosition, 20, undefined);
    const context = RouteContextFactory.make(new Map([
        [carriedParcel.id, carriedParcel],
        [candidateParcel.id, candidateParcel],
    ]), [nearestDelivery, onRouteDelivery]);
    const nearestDeliveryScore = ParcelRouteEvaluator.scoreDeliveryFirst(context, agentPosition, nearestDelivery);
    const onRouteDeliveryScore = ParcelRouteEvaluator.scoreDeliveryFirst(context, agentPosition, onRouteDelivery);
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
    const knownParcel = ParcelFixtureFactory.make("known", new Position(1, 0), 10, undefined);
    const newParcel = ParcelFixtureFactory.make("new", new Position(2, 0), 10, undefined);
    const previousIds = new Set([knownParcel.id]);
    assert.equal(ParcelRouteEvaluator.freeParcelSetChanged(previousIds, new Map([[knownParcel.id, knownParcel]])), false);
    assert.equal(ParcelRouteEvaluator.freeParcelSetChanged(previousIds, new Map([
        [knownParcel.id, knownParcel],
        [newParcel.id, newParcel],
    ])), true);
});
//# sourceMappingURL=_parcel-route-evaluator.test.js.map