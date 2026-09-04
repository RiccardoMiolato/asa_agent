import assert from "node:assert/strict";
import test from "node:test";
import { parseFastDownwardPlan, } from "./pddl/onlineSolver.js";
test("Fast Downward plans are converted to PDDL plan steps", () => {
    const plan = parseFastDownwardPlan(`
(move-up ag_1 t_0_0 t_0_1)
(crate-move-right ag_1 t_0_1 t_1_1 t_2_1 crate_1)
; cost = 2 (unit cost)
`);
    assert.deepEqual(plan, [
        {
            parallel: false,
            action: "move-up",
            args: ["ag_1", "t_0_0", "t_0_1"],
        },
        {
            parallel: false,
            action: "crate-move-right",
            args: ["ag_1", "t_0_1", "t_1_1", "t_2_1", "crate_1"],
        },
    ]);
});
test("Fast Downward zero-action plans are accepted", () => {
    assert.deepEqual(parseFastDownwardPlan("; cost = 0 (unit cost)\n"), []);
});
test("malformed Fast Downward plan actions are rejected", () => {
    assert.throws(() => parseFastDownwardPlan("move-up ag_1 t_0_0 t_0_1"), /Invalid Fast Downward plan line/);
});
//# sourceMappingURL=_local-pddl-solver.test.js.map