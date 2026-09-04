import assert from "node:assert/strict";
import { test } from "node:test";
import { BaseAgentLogger, } from "./_logging.js";
import { Beliefs } from "./beliefs.js";
import { ConservativeMovementGuard } from "./movement-safety.js";
import { Position } from "./position.js";
class RecordingAgentLogger extends BaseAgentLogger {
    constructor() {
        super(...arguments);
        this.movements = [];
    }
    logDeliberation(_deliberation) { }
    logDeliveryGain(_delivery) { }
    logMovementSafety(movement) {
        this.movements.push(movement);
    }
}
class MovementSafetyFixture {
    constructor() {
        this.beliefs = new Beliefs();
        this.logger = new RecordingAgentLogger();
        this.guard = new ConservativeMovementGuard(this.beliefs, this.logger);
        this.destination = new Position(2, 0);
    }
    sense(x, y) {
        this.beliefs.revise([], [], [], [this.agentAt(x, y)]);
    }
    async senseNext(x, y) {
        this.sense(x, y);
        await Promise.resolve();
    }
    async senseAgentAbsent(observeDestination) {
        this.beliefs.revise([], [], observeDestination ? [this.destination] : [], []);
        await Promise.resolve();
    }
    async assertStillWaiting(clearance) {
        let resolved = false;
        void clearance.then(() => {
            resolved = true;
        });
        await Promise.resolve();
        assert.equal(resolved, false);
    }
    agentAt(x, y) {
        return {
            id: "other-agent",
            name: "other",
            teamId: "other-team",
            teamName: "Other team",
            x,
            y,
            score: 0,
            penalty: 0,
        };
    }
}
test("an unrelated moving agent neither delays nor produces encounter logs", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(4.6, 0);
    await fixture.guard.waitUntilSafe(fixture.destination);
    assert.deepEqual(fixture.logger.movements, []);
});
test("moving from our next cell logs the complete wait and clearance", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.6, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    await fixture.assertStillWaiting(clearance);
    await fixture.senseNext(3, 0);
    await fixture.assertStillWaiting(clearance);
    await fixture.senseNext(3.6, 0);
    await clearance;
    assert.deepEqual(fixture.logger.movements.map(({ event, decision, reason }) => ({
        event,
        decision,
        reason,
    })), [
        {
            event: "encountered",
            decision: "wait",
            reason: "agent-moving-from-next-cell",
        },
        {
            event: "observed",
            decision: "wait",
            reason: "departure-completed",
        },
        {
            event: "cleared",
            decision: "move",
            reason: "next-move-is-safe",
        },
    ]);
    assert.deepEqual(fixture.logger.movements[0].movementSource, new Position(2, 0));
    assert.deepEqual(fixture.logger.movements[0].movementDestination, new Position(3, 0));
});
test("moving to our next cell logs arrival, departure, and the next move", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.4, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    await fixture.senseNext(2, 0);
    await fixture.senseNext(1.4, 0);
    await fixture.senseNext(1, 0);
    await fixture.assertStillWaiting(clearance);
    await fixture.senseNext(0.4, 0);
    await clearance;
    assert.deepEqual(fixture.logger.movements.map((movement) => movement.reason), [
        "agent-moving-to-next-cell",
        "agent-on-next-cell",
        "agent-moving-from-next-cell",
        "departure-completed",
        "next-move-is-safe",
    ]);
});
test("returning to our next cell is logged and restarts the wait", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.6, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    await fixture.senseNext(3, 0);
    await fixture.senseNext(2.4, 0);
    await fixture.assertStillWaiting(clearance);
    assert.equal(fixture.logger.movements[fixture.logger.movements.length - 1]?.reason, "agent-returning-to-next-cell");
    await fixture.senseNext(2, 0);
    await fixture.senseNext(1.4, 0);
    await fixture.senseNext(1, 0);
    await fixture.senseNext(0.4, 0);
    await clearance;
});
test("coalesced sensing still recognizes departure and a safe next move", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.4, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    // The server did not expose the stationary target or fractional departure.
    await fixture.senseNext(1, 0);
    await fixture.assertStillWaiting(clearance);
    // The next fractional frame was coalesced too, but the second completed
    // move proves that the agent did not return to our next cell.
    await fixture.senseNext(0, 0);
    await clearance;
    assert.deepEqual(fixture.logger.movements.map((movement) => movement.reason), [
        "agent-moving-to-next-cell",
        "departure-completed",
        "next-move-is-safe",
    ]);
});
test("leaving observation clears the wait when our next cell is covered", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.4, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    await fixture.senseAgentAbsent(true);
    await clearance;
    assert.equal(fixture.logger.movements[fixture.logger.movements.length - 1]?.reason, "agent-left-observation-range");
    assert.equal(fixture.logger.movements[fixture.logger.movements.length - 1]?.decision, "move");
});
test("an absent agent still blocks when our next cell is not covered", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.sense(2.4, 0);
    const clearance = fixture.guard.waitUntilSafe(fixture.destination);
    await fixture.senseAgentAbsent(false);
    await fixture.assertStillWaiting(clearance);
    assert.equal(fixture.logger.movements[fixture.logger.movements.length - 1]?.reason, "agent-not-visible");
    await fixture.senseAgentAbsent(true);
    await clearance;
});
//# sourceMappingURL=_movement-safety.test.js.map