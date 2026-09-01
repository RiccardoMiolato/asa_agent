import assert from "node:assert/strict";
import test from "node:test";
import {
    BaseAgentLogger,
    type DeliveryGainLog,
    type MovementSafetyLog,
} from "./_logging.js";
import { Beliefs } from "./beliefs.js";
import {
    ConservativeMovementGuard,
    type MovementClearance,
} from "./movement-safety.js";
import { Position } from "./position.js";
import type { IOSensedAgent } from "../types/IOSensing.js";

/** Captures movement-guard decisions without producing console output. */
class RecordingMovementLogger extends BaseAgentLogger {
    readonly movements: MovementSafetyLog[] = [];

    override logDeliveryGain(_delivery: DeliveryGainLog): void { }

    override logMovementSafety(movement: MovementSafetyLog): void {
        this.movements.push(movement);
    }
}

/** Creates movement observations for one nearby agent. */
class MovementSafetyFixture {
    readonly beliefs = new Beliefs();
    readonly logger = new RecordingMovementLogger();
    readonly guard = new ConservativeMovementGuard(
        this.beliefs,
        this.logger,
    );
    readonly destination = new Position(7, 11);

    constructor() {
        this.beliefs.movement_duration = 5;
        this.beliefs.frame_duration = 1;
    }

    senseAgentAt(x: number, y: number): void {
        const agent: IOSensedAgent = {
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

    const clearance: MovementClearance = await fixture.guard.waitUntilSafe(
        fixture.destination,
    );

    assert.deepEqual(clearance, {
        decision: "replan",
        blockedCell: fixture.destination,
    });
    assert.deepEqual(
        fixture.logger.movements.map(
            ({ event, decision, reason }): {
                readonly event: string;
                readonly decision: string;
                readonly reason: string;
            } => ({ event, decision, reason }),
        ),
        [
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
        ],
    );
});

test("an unconfirmed arrival expires into a conservative replan", async () => {
    const fixture = new MovementSafetyFixture();
    fixture.senseAgentAt(7, 11.4);

    const clearance: MovementClearance = await fixture.guard.waitUntilSafe(
        fixture.destination,
    );

    assert.deepEqual(clearance, {
        decision: "replan",
        blockedCell: fixture.destination,
    });
    assert.deepEqual(
        fixture.logger.movements.map(
            ({ event, decision, reason }): {
                readonly event: string;
                readonly decision: string;
                readonly reason: string;
            } => ({ event, decision, reason }),
        ),
        [
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
        ],
    );
});
