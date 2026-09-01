import assert from "node:assert/strict";
import test from "node:test";
import { Beliefs } from "./beliefs.js";
import { PickUp, type GameClient, type MoveDirection } from "./move.js";
import type { IOCrate } from "../types/IOCrate.js";
import type { IOParcel } from "../types/IOParcel.js";
import type {
    IOSensedAgent,
    IOSensedPosition,
} from "../types/IOSensing.js";

/** Records whether a duplicate pickup request reaches the game server. */
class RecordingGameClient implements GameClient {
    pickupCount = 0;

    constructor(private readonly onPickup?: () => void) { }

    async emitMove(_direction: MoveDirection): Promise<false> {
        return false;
    }

    async emitPickup(): Promise<{ id: string }[]> {
        this.pickupCount += 1;
        this.onPickup?.();
        return [];
    }

    async emitPutdown(
        _selected?: string[] | null,
    ): Promise<{ id: string }[]> {
        return [];
    }
}

/** Creates complete sensing snapshots for one parcel and observed cell. */
class PickupSynchronizationFixture {
    static readonly AGENT_ID = "agent-1";
    static readonly PARCEL_ID = "parcel-1";
    static readonly OBSERVED_POSITION: IOSensedPosition = { x: 4, y: 7 };

    static parcel(carriedBy?: string | null): IOParcel {
        return {
            id: PickupSynchronizationFixture.PARCEL_ID,
            x: PickupSynchronizationFixture.OBSERVED_POSITION.x,
            y: PickupSynchronizationFixture.OBSERVED_POSITION.y,
            reward: 10,
            carriedBy,
        };
    }

    static revise(
        beliefs: Beliefs,
        parcels: IOParcel[],
    ): void {
        beliefs.reviseWithChanges(
            parcels,
            [] satisfies IOCrate[],
            [PickupSynchronizationFixture.OBSERVED_POSITION],
            [] satisfies IOSensedAgent[],
        );
    }

    static confirmedBeliefs(): Beliefs {
        const beliefs = new Beliefs();
        PickupSynchronizationFixture.revise(
            beliefs,
            [PickupSynchronizationFixture.parcel()],
        );
        beliefs.markParcelCarried(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        );
        return beliefs;
    }
}

test("a stale free snapshot cannot undo a confirmed local pickup", async () => {
    const beliefs = PickupSynchronizationFixture.confirmedBeliefs();
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel(null)],
    );
    const client = new RecordingGameClient();
    const pickup = new PickUp(
        client,
        beliefs,
        PickupSynchronizationFixture.PARCEL_ID,
        PickupSynchronizationFixture.AGENT_ID,
    );

    assert.equal(
        beliefs.isParcelCarriedBy(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        ),
        true,
    );
    assert.equal(await pickup.execute(), true);
    assert.equal(client.pickupCount, 0);
});

test("an absent snapshot cannot delete a confirmed carried parcel", () => {
    const beliefs = PickupSynchronizationFixture.confirmedBeliefs();
    PickupSynchronizationFixture.revise(beliefs, []);

    assert.equal(
        beliefs.isParcelCarriedBy(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        ),
        true,
    );
});

test("ownership learned from sensing becomes locally confirmed", async () => {
    const beliefs = new Beliefs();
    PickupSynchronizationFixture.revise(
        beliefs,
        [
            PickupSynchronizationFixture.parcel(
                PickupSynchronizationFixture.AGENT_ID,
            ),
        ],
    );
    const client = new RecordingGameClient();
    const pickup = new PickUp(
        client,
        beliefs,
        PickupSynchronizationFixture.PARCEL_ID,
        PickupSynchronizationFixture.AGENT_ID,
    );

    assert.equal(await pickup.execute(), true);
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel(null)],
    );

    assert.equal(
        beliefs.isParcelCarriedBy(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        ),
        true,
    );
    assert.equal(client.pickupCount, 0);
});

test("a completed pickup request resolves an otherwise stale free belief", async () => {
    const beliefs = new Beliefs();
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel()],
    );
    const client = new RecordingGameClient((): void => {
        PickupSynchronizationFixture.revise(
            beliefs,
            [PickupSynchronizationFixture.parcel()],
        );
    });
    const pickup = new PickUp(
        client,
        beliefs,
        PickupSynchronizationFixture.PARCEL_ID,
        PickupSynchronizationFixture.AGENT_ID,
    );

    assert.equal(await pickup.execute(), true);
    assert.equal(
        beliefs.isParcelCarriedBy(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        ),
        true,
    );
    assert.equal(await pickup.execute(), true);
    assert.equal(client.pickupCount, 1);
});

test("an empty pickup response is not inferred for an unobserved cell", async () => {
    const beliefs = new Beliefs();
    beliefs.senseParcels([PickupSynchronizationFixture.parcel()]);
    const client = new RecordingGameClient();
    const pickup = new PickUp(
        client,
        beliefs,
        PickupSynchronizationFixture.PARCEL_ID,
        PickupSynchronizationFixture.AGENT_ID,
    );

    assert.equal(await pickup.execute(), false);
    assert.equal(
        beliefs.isParcelCarriedBy(
            PickupSynchronizationFixture.PARCEL_ID,
            PickupSynchronizationFixture.AGENT_ID,
        ),
        false,
    );
    assert.equal(client.pickupCount, 1);
});

test("another authoritative carrier overrides the local confirmation", () => {
    const beliefs = PickupSynchronizationFixture.confirmedBeliefs();
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel("agent-2")],
    );
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel(null)],
    );

    assert.equal(
        beliefs.parcels.get(PickupSynchronizationFixture.PARCEL_ID)?.carriedBy,
        undefined,
    );
});

test("delivery clears the local pickup confirmation", () => {
    const beliefs = PickupSynchronizationFixture.confirmedBeliefs();
    beliefs.clearDeliveredParcels(PickupSynchronizationFixture.AGENT_ID);
    PickupSynchronizationFixture.revise(
        beliefs,
        [PickupSynchronizationFixture.parcel(null)],
    );

    assert.equal(
        beliefs.parcels.get(PickupSynchronizationFixture.PARCEL_ID)?.carriedBy,
        undefined,
    );
});
