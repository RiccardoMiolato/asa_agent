import assert from "node:assert/strict";
import test from "node:test";
import { BELIEF_CHANGE_TYPE, Beliefs } from "./beliefs.js";
test("parcel reward and carrier changes invalidate the current plan", () => {
    const beliefs = new Beliefs();
    const parcel = {
        id: "parcel-1",
        x: 2,
        y: 3,
        reward: 5,
    };
    assert.equal(beliefs.revise([parcel], [], [{ x: 2, y: 3 }]), true);
    assert.equal(beliefs.revise([parcel], [], [{ x: 2, y: 3 }]), false);
    assert.equal(beliefs.revise([{ ...parcel, reward: 4 }], [], [{ x: 2, y: 3 }]), true);
    assert.equal(beliefs.revise([{ ...parcel, reward: 4, carriedBy: "other-agent" }], [], [{ x: 2, y: 3 }]), true);
});
test("a parcel missing from an observed cell is removed", () => {
    const beliefs = new Beliefs();
    const parcel = {
        id: "parcel-1",
        x: 2,
        y: 3,
        reward: 5,
    };
    beliefs.revise([parcel], [], [{ x: 2, y: 3 }]);
    assert.equal(beliefs.revise([], [], [{ x: 2, y: 3 }]), true);
    assert.equal(beliefs.parcels.has(parcel.id), false);
});
test("detailed revisions identify normal reward degradation", () => {
    const beliefs = new Beliefs();
    const parcel = {
        id: "parcel-1",
        x: 2,
        y: 3,
        reward: 5,
    };
    beliefs.reviseWithChanges([parcel], [], [{ x: 2, y: 3 }]);
    const revision = beliefs.reviseWithChanges([{ ...parcel, reward: 4 }], [], [{ x: 2, y: 3 }]);
    assert.deepEqual(revision.changes, [{
            type: BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED,
            parcelId: parcel.id,
            previousReward: 5,
            currentReward: 4,
        }]);
});
//# sourceMappingURL=_belief-changes.test.js.map