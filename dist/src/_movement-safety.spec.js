import assert from "node:assert/strict";
import test from "node:test";
import { BaseAgentLogger, } from "./_logging.js";
import { Beliefs } from "./beliefs.js";
import { ConservativeMovementGuard, } from "./movement-safety.js";
import { Position } from "./position.js";
/** Captures movement-guard decisions without producing console output. */
class RecordingMovementLogger extends BaseAgentLogger {
    constructor() {
        super(...arguments);
        this.movements = [];
    }
    logDeliveryGain(_delivery) { }
    logMovementSafety(movement) {
        this.movements.push(movement);
    }
}
/** Creates movement observations for one nearby agent. */
class MovementSafetyFixture {
    constructor() {
        this.beliefs = new Beliefs();
        this.logger = new RecordingMovementLogger();
        this.guard = new ConservativeMovementGuard(this.beliefs, this.logger);
        this.destination = new Position(7, 11);
        this.beliefs.movement_duration = 5;
        this.beliefs.frame_duration = 1;
    }
    senseAgentAt(x, y) {
        const agent = {
            id: "a16",
            name: "a16",
            teamId: "other-team",
            teamName: "Other team",
            x,
            y,
            score: 0,
            penalty: 0,
        };
        this.beliefs.revise([], [], [], [agent]);
    }
}
test("an unconfirmed departure expires into a conservative replan", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.senseAgentAt(7, 10.4);
    const clearance = await fixture.guard.waitUntilSafe(fixture.destination);
    assert.deepEqual(clearance, {
        decision: "replan",
        blockedCell: fixture.destination,
    });
    assert.deepEqual(fixture.logger.movements.map(({ event, decision, reason }) => ({ event, decision, reason })), [
        {
            event: "encountered",
            decision: "wait",
            reason: "agent-moving-from-next-cell",
        },
        {
            event: "replanned",
            decision: "replan",
            reason: "movement-uncertain-replan",
        },
    ]);
});
test("an unconfirmed arrival expires into a conservative replan", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.senseAgentAt(7, 11.4);
    const clearance = await fixture.guard.waitUntilSafe(fixture.destination);
    assert.deepEqual(clearance, {
        decision: "replan",
        blockedCell: fixture.destination,
    });
    assert.deepEqual(fixture.logger.movements.map(({ event, decision, reason }) => ({ event, decision, reason })), [
        {
            event: "encountered",
            decision: "wait",
            reason: "agent-moving-to-next-cell",
        },
        {
            event: "replanned",
            decision: "replan",
            reason: "movement-uncertain-replan",
        },
    ]);
});
//# sourceMappingURL=_movement-safety.spec.js.map