/** Regression tests for game-configured parcel reward decay. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AStarPathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { DeliverParcelIntention, } from "./intentions.js";
import { ActionFactory, } from "./move.js";
import { Position } from "./position.js";
/** No-op game client used to satisfy executable-action dependencies. */
class TestGameClient {
    async emitMove(_direction) {
        return { x: 0, y: 0 };
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown(_selected) {
        return [];
    }
}
/** Creates fully typed reward-decay scenarios. */
class RewardDecayFixtureFactory {
    static makeConfig(decayingEvent, clock = 50) {
        return {
            CLOCK: clock,
            GAME: {
                map: { tiles: [["3"]] },
                parcels: { decaying_event: decayingEvent },
                player: {
                    movement_duration: 50,
                    observation_distance: 5,
                },
            },
        };
    }
    static makeDeliveryContext(rewardDecayInterval, millisecondsUntilNextRewardDecay) {
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(new TestGameClient(), beliefs);
        const pathfinder = new AStarPathfinder(actionFactory);
        const agentId = "test-agent";
        const carriedParcel = {
            id: "carried",
            x: 0,
            y: 0,
            carriedBy: agentId,
            reward: 50,
            lastUpdate: new Date(),
        };
        return {
            gameMap: Array.from({ length: 21 }, () => ["3"]),
            agentPosition: new Position(0, 0),
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [new Position(20, 0)],
            parcels: new Map([[carriedParcel.id, carriedParcel]]),
            movementDuration: 50,
            frameDuration: 50,
            observationDistance: 5,
            rewardDecayInterval,
            millisecondsUntilNextRewardDecay,
            freeParcelsCount: 0,
            agentId,
            pathfinder,
            actionFactory,
        };
    }
}
test("beliefs map every supported clock event to its real interval", () => {
    const expectedIntervals = new Map([
        ["frame", 40],
        ["1s", 1000],
        ["2s", 2000],
        ["5s", 5000],
        ["10s", 10000],
        ["1m", 60000],
        ["1h", 3600000],
        ["infinite", undefined],
    ]);
    for (const [event, expectedInterval] of expectedIntervals) {
        const beliefs = new Beliefs();
        beliefs.configPhase(RewardDecayFixtureFactory.makeConfig(event, 40));
        assert.equal(beliefs.rewardDecayIntervalMilliseconds(), expectedInterval);
    }
});
test("beliefs retain the server's one-second default when decay is omitted", () => {
    const config = RewardDecayFixtureFactory.makeConfig("2s");
    delete config.GAME.parcels;
    const beliefs = new Beliefs();
    beliefs.configPhase(config);
    assert.equal(beliefs.rewardDecayIntervalMilliseconds(), 1000);
});
test("stale beliefs decay at the configured two-second cadence", () => {
    const beliefs = new Beliefs();
    beliefs.configPhase(RewardDecayFixtureFactory.makeConfig("2s"));
    beliefs.parcels.set("parcel", {
        id: "parcel",
        x: 0,
        y: 0,
        reward: 50,
        lastUpdate: new Date(Date.now() - 2500),
    });
    beliefs.updateParcelRewards();
    assert.equal(beliefs.parcels.get("parcel")?.reward, 49);
});
test("long-delivery estimates respect one-second, two-second, and infinite decay", () => {
    const deliveryCell = new Position(20, 0);
    const scenarios = [
        { interval: 1000, nextDecay: 1000, expectedGain: 47 },
        { interval: 2000, nextDecay: 2000, expectedGain: 49 },
        { interval: undefined, nextDecay: undefined, expectedGain: 50 },
    ];
    for (const scenario of scenarios) {
        const intention = new DeliverParcelIntention(deliveryCell, new Set());
        const score = intention.score(RewardDecayFixtureFactory.makeDeliveryContext(scenario.interval, scenario.nextDecay));
        assert.equal(score, scenario.expectedGain);
    }
});
//# sourceMappingURL=_reward-decay.test.js.map