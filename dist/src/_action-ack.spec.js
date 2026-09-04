import assert from "node:assert/strict";
import test from "node:test";
import { BELIEF_CHANGE_TYPE, Beliefs, PICKUP_CONFIDENCE, } from "./beliefs.js";
import { Drop, PickUp, } from "./move.js";
/** Game client whose action acknowledgements and sensing races are controlled. */
class AcknowledgementGameClient {
    constructor(pickedParcels = [], droppedParcels = [], onPickup, onPutdown) {
        this.pickedParcels = pickedParcels;
        this.droppedParcels = droppedParcels;
        this.onPickup = onPickup;
        this.onPutdown = onPutdown;
        this.pickupCount = 0;
        this.putdownCount = 0;
    }
    async emitMove(_direction) {
        return false;
    }
    async emitPickup() {
        this.pickupCount += 1;
        this.onPickup?.();
        return this.pickedParcels;
    }
    async emitPutdown(selected) {
        this.putdownCount += 1;
        this.selectedPutdownParcelIds = selected;
        this.onPutdown?.();
        return this.droppedParcels;
    }
}
/** Canonical parcel-action test data and complete sensing snapshots. */
class ParcelActionFixture {
    constructor() {
        this.beliefs = new Beliefs();
        this.revise([ParcelActionFixture.parcel()]);
    }
    static parcel(id = ParcelActionFixture.FIRST_PARCEL_ID, carriedBy) {
        return {
            id,
            x: ParcelActionFixture.OBSERVED_POSITION.x,
            y: ParcelActionFixture.OBSERVED_POSITION.y,
            reward: 10,
            carriedBy,
        };
    }
    revise(parcels) {
        this.beliefs.reviseWithChanges(parcels, [], [ParcelActionFixture.OBSERVED_POSITION], []);
    }
    markCarried(parcelId = ParcelActionFixture.FIRST_PARCEL_ID) {
        this.beliefs.markParcelCarried(parcelId, ParcelActionFixture.AGENT_ID);
    }
    pickup(client) {
        return new PickUp(client, this.beliefs, ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID);
    }
    drop(client) {
        return new Drop(client, this.beliefs, ParcelActionFixture.AGENT_ID);
    }
}
ParcelActionFixture.AGENT_ID = "agent-1";
ParcelActionFixture.FIRST_PARCEL_ID = "parcel-1";
ParcelActionFixture.SECOND_PARCEL_ID = "parcel-2";
ParcelActionFixture.OBSERVED_POSITION = { x: 4, y: 7 };
test("pickup succeeds when its acknowledgement contains the target", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([
        { id: ParcelActionFixture.FIRST_PARCEL_ID },
    ]);
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.get(ParcelActionFixture.FIRST_PARCEL_ID)?.carriedBy, ParcelActionFixture.AGENT_ID);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), PICKUP_CONFIDENCE.CONFIRMED);
});
test("empty pickup acknowledgement records the target as carried", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), PICKUP_CONFIDENCE.PROVISIONAL);
});
test("later free sensing revokes provisional pickup ownership", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    fixture.revise([ParcelActionFixture.parcel()]);
    assert.equal(fixture.beliefs.parcels.get(ParcelActionFixture.FIRST_PARCEL_ID)?.carriedBy, undefined);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), undefined);
});
test("later rival sensing revokes provisional pickup ownership", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, "other-agent"),
    ]);
    assert.equal(fixture.beliefs.parcels.get(ParcelActionFixture.FIRST_PARCEL_ID)?.carriedBy, "other-agent");
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), undefined);
});
test("sensing local ownership promotes a provisional pickup", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID),
    ]);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), PICKUP_CONFIDENCE.CONFIRMED);
});
test("rival ownership sensed during pickup prevents a ghost parcel", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([], [], () => fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, "other-agent"),
    ]));
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.get(ParcelActionFixture.FIRST_PARCEL_ID)?.carriedBy, "other-agent");
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), undefined);
});
test("in-flight ownership survives a later stale free sensing frame", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([], [], () => {
        fixture.revise([
            ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID),
        ]);
        fixture.revise([ParcelActionFixture.parcel()]);
    });
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.isParcelCarriedBy(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), true);
});
test("empty pickup acknowledgement succeeds despite stale free sensing", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([], [], () => fixture.revise([ParcelActionFixture.parcel()]));
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.get(ParcelActionFixture.FIRST_PARCEL_ID)?.carriedBy, ParcelActionFixture.AGENT_ID);
});
test("empty pickup acknowledgement overrides an absent sensing frame", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([], [], () => fixture.revise([]));
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), PICKUP_CONFIDENCE.PROVISIONAL);
});
test("an absent provisional parcel is discarded by the next drop", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    fixture.revise([]);
    assert.equal(fixture.beliefs.parcelPickupConfidence(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), PICKUP_CONFIDENCE.PROVISIONAL);
    assert.equal(await fixture.drop(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.FIRST_PARCEL_ID), false);
});
test("a zero-reward parcel produces an explicit expiration change", () => {
    const fixture = new ParcelActionFixture();
    const revision = fixture.beliefs.reviseWithChanges([{
            ...ParcelActionFixture.parcel(),
            reward: 0,
        }], [], [ParcelActionFixture.OBSERVED_POSITION], []);
    assert.equal(revision.changes.some((change) => change.type === BELIEF_CHANGE_TYPE.PARCEL_EXPIRED
        && change.parcelId === ParcelActionFixture.FIRST_PARCEL_ID), true);
});
test("stale sensing cannot undo an acknowledged pickup", async () => {
    const fixture = new ParcelActionFixture();
    const client = new AcknowledgementGameClient([
        { id: ParcelActionFixture.FIRST_PARCEL_ID },
    ]);
    assert.equal(await fixture.pickup(client).execute(), true);
    fixture.revise([ParcelActionFixture.parcel()]);
    fixture.revise([]);
    assert.equal(fixture.beliefs.isParcelCarriedBy(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), true);
});
test("already confirmed pickup does not issue a duplicate request", async () => {
    const fixture = new ParcelActionFixture();
    fixture.markCarried();
    const client = new AcknowledgementGameClient();
    assert.equal(await fixture.pickup(client).execute(), true);
    assert.equal(client.pickupCount, 0);
});
test("drop clears beliefs only after putdown returns", async () => {
    const fixture = new ParcelActionFixture();
    fixture.markCarried();
    const client = new AcknowledgementGameClient([], [{ id: ParcelActionFixture.FIRST_PARCEL_ID }], undefined, () => {
        assert.equal(fixture.beliefs.isParcelCarriedBy(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID), true);
    });
    assert.equal(await fixture.drop(client).execute(), true);
    assert.deepEqual(client.selectedPutdownParcelIds, [ParcelActionFixture.FIRST_PARCEL_ID]);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.FIRST_PARCEL_ID), false);
    fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID),
    ]);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.FIRST_PARCEL_ID), false);
});
test("empty drop acknowledgement completes delivery despite stale sensing", async () => {
    const fixture = new ParcelActionFixture();
    fixture.markCarried();
    const client = new AcknowledgementGameClient([], [], undefined, () => fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID, ParcelActionFixture.AGENT_ID),
    ]));
    assert.equal(await fixture.drop(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.FIRST_PARCEL_ID), false);
});
test("partial drop acknowledgement completes every selected delivery", async () => {
    const fixture = new ParcelActionFixture();
    fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.FIRST_PARCEL_ID),
        ParcelActionFixture.parcel(ParcelActionFixture.SECOND_PARCEL_ID),
    ]);
    fixture.markCarried(ParcelActionFixture.FIRST_PARCEL_ID);
    fixture.markCarried(ParcelActionFixture.SECOND_PARCEL_ID);
    const client = new AcknowledgementGameClient([], [{ id: ParcelActionFixture.FIRST_PARCEL_ID }], undefined, () => fixture.revise([
        ParcelActionFixture.parcel(ParcelActionFixture.SECOND_PARCEL_ID, ParcelActionFixture.AGENT_ID),
    ]));
    assert.equal(await fixture.drop(client).execute(), true);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.FIRST_PARCEL_ID), false);
    assert.equal(fixture.beliefs.parcels.has(ParcelActionFixture.SECOND_PARCEL_ID), false);
});
//# sourceMappingURL=_action-ack.spec.js.map