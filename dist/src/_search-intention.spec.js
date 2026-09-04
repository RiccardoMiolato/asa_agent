import assert from "node:assert/strict";
import test from "node:test";
import { BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { SearchIntention } from "./intentions.js";
import { Action, ActionFactory } from "./move.js";
import { Position } from "./position.js";
/** Inert movement used to make exploration routes deterministic. */
class SearchStep extends Action {
    async execute() {
        return true;
    }
}
/** Manhattan pathfinder for isolated exploration-policy tests. */
class SearchPathfinder extends BasePathfinder {
    findPath(_gameMap, startingPosition, targetPosition, _crates) {
        return Array.from({ length: startingPosition.distanceTo(targetPosition) }, () => new SearchStep());
    }
}
/** Inert client required by the planning context's action factory. */
class SearchGameClient {
    async emitMove() {
        return false;
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown() {
        return [];
    }
}
/** Creates an unlimited-sensing world with three disconnected pickup clusters. */
class SearchIntentionFixture {
    static context(agentPosition) {
        const gameMap = Array.from({ length: 9 }, () => ["1"]);
        return {
            gameMap,
            agentPosition,
            crates: new Map(),
            pickupCells: [
                SearchIntentionFixture.FIRST_CLUSTER,
                SearchIntentionFixture.SECOND_CLUSTER,
                SearchIntentionFixture.THIRD_CLUSTER,
            ],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [],
            parcels: new Map(),
            movementDuration: 0,
            frameDuration: 0,
            observationDistance: -1,
            rewardDecayInterval: undefined,
            millisecondsUntilNextRewardDecay: undefined,
            agentId: "agent-1",
            pathfinder: new SearchPathfinder(),
            actionFactory: new ActionFactory(new SearchGameClient(), new Beliefs()),
        };
    }
}
SearchIntentionFixture.FIRST_CLUSTER = new Position(0, 0);
SearchIntentionFixture.SECOND_CLUSTER = new Position(4, 0);
SearchIntentionFixture.THIRD_CLUSTER = new Position(8, 0);
test("fully observable clusters still produce a physical patrol route", () => {
    const intention = new SearchIntention();
    const actions = intention.buildActions(SearchIntentionFixture.context(SearchIntentionFixture.FIRST_CLUSTER));
    assert.equal(actions.length, 4);
    assert.equal(intention.describe().target?.isEqual(SearchIntentionFixture.SECOND_CLUSTER), true);
    assert.equal(intention.isSatisfied(), false);
});
test("completed patrol routes rotate through the other clusters", () => {
    const intention = new SearchIntention();
    intention.buildActions(SearchIntentionFixture.context(SearchIntentionFixture.FIRST_CLUSTER));
    intention.onPlanCompleted();
    const secondRoute = intention.buildActions(SearchIntentionFixture.context(SearchIntentionFixture.SECOND_CLUSTER));
    assert.equal(secondRoute.length, 4);
    assert.equal(intention.describe().target?.isEqual(SearchIntentionFixture.THIRD_CLUSTER), true);
    intention.onPlanCompleted();
    const thirdRoute = intention.buildActions(SearchIntentionFixture.context(SearchIntentionFixture.THIRD_CLUSTER));
    assert.equal(thirdRoute.length, 8);
    assert.equal(intention.describe().target?.isEqual(SearchIntentionFixture.FIRST_CLUSTER), true);
});
//# sourceMappingURL=_search-intention.spec.js.map