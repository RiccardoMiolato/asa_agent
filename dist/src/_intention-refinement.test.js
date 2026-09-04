import assert from "node:assert/strict";
import test from "node:test";
import { IntentionRefiner, } from "./_intention-refinement.js";
import { BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { RewardIntention, } from "./intentions.js";
import { Action, ActionFactory } from "./move.js";
import { BasePDDLPlanner, } from "./pddl/pddlPlanner.js";
import { Position } from "./position.js";
class SuccessfulAction extends Action {
    async execute() {
        return true;
    }
}
class ConfigurablePathfinder extends BasePathfinder {
    constructor(reachableDistances) {
        super();
        this.reachableDistances = reachableDistances;
    }
    findPath(_gameMap, _startingPosition, targetPosition, _crates) {
        const distance = this.reachableDistances.get(`${targetPosition.x},${targetPosition.y}`);
        return distance === undefined
            ? []
            : Array.from({ length: distance }, () => new SuccessfulAction());
    }
}
class FixedRewardIntention extends RewardIntention {
    constructor(id, target, expectedScore) {
        super();
        this.id = id;
        this.target = target;
        this.expectedScore = expectedScore;
    }
    score(_context) {
        return this.expectedScore;
    }
    scoreWithNavigationDistance(_context, navigationDistance) {
        return this.expectedScore - navigationDistance;
    }
    buildActions(_context) {
        return [];
    }
    toPddlGoal(context) {
        return {
            agentId: context.agentId,
            finalTargetPosition: this.target,
        };
    }
    describe() {
        return {
            type: "pick-up",
            parcelId: this.id,
            target: this.target,
            reward: this.expectedScore,
        };
    }
}
class RecordingPDDLPlanner extends BasePDDLPlanner {
    constructor(results) {
        super();
        this.results = results;
        this.requestedTargets = [];
    }
    async solveNavigation(request) {
        const target = request.goal.finalTargetPosition;
        const key = `${target.x},${target.y}`;
        this.requestedTargets.push(key);
        return this.results.get(key) ?? { status: "unreachable" };
    }
}
function makeActionFactory() {
    const beliefs = new Beliefs();
    return new ActionFactory({
        emitMove: async () => false,
        emitPickup: async () => [],
        emitPutdown: async () => [],
    }, beliefs);
}
function makeContext(pathfinder) {
    return {
        gameMap: Array.from({ length: 7 }, () => ["5"]),
        agentPosition: new Position(0, 0),
        crates: new Map([
            ["first-wall", new Position(2, 0)],
            ["second-wall", new Position(5, 0)],
        ]),
        pickupCells: [],
        pickupCellLastObservedAt: new Map(),
        deliveringCells: [],
        parcels: new Map(),
        movementDuration: 0,
        frameDuration: 0,
        observationDistance: 0,
        rewardDecayInterval: undefined,
        millisecondsUntilNextRewardDecay: undefined,
        freeParcelsCount: 0,
        agentId: "agent",
        pathfinder,
        actionFactory: makeActionFactory(),
    };
}
function optimisticEvaluation(intention) {
    return {
        intention,
        score: intention.expectedScore,
        distance: undefined,
        status: "optimistic",
    };
}
test("refinement backfills unreachable diverse candidates", async () => {
    const highest = new FixedRewardIntention("highest", new Position(3, 0), 100);
    const reachable = new FixedRewardIntention("reachable", new Position(1, 0), 90);
    const sameComponent = new FixedRewardIntention("same-component", new Position(4, 0), 80);
    const diverse = new FixedRewardIntention("diverse", new Position(6, 0), 70);
    const pathfinder = new ConfigurablePathfinder(new Map([["1,0", 1]]));
    const planner = new RecordingPDDLPlanner(new Map([
        ["3,0", { status: "unreachable" }],
        ["6,0", { status: "unreachable" }],
        ["4,0", {
                status: "solved",
                plan: {
                    actions: [new SuccessfulAction(), new SuccessfulAction()],
                    movementCount: 2,
                    pushCount: 1,
                },
            }],
    ]));
    const refiner = new IntentionRefiner(planner, {
        feasibleCandidateLimit: 3,
        planningBudgetMilliseconds: 1000,
    });
    const result = await refiner.refine([
        optimisticEvaluation(highest),
        optimisticEvaluation(reachable),
        optimisticEvaluation(sameComponent),
        optimisticEvaluation(diverse),
    ], makeContext(pathfinder));
    assert.deepEqual(planner.requestedTargets, ["3,0", "6,0", "4,0"]);
    assert.equal(result.selected?.intention, reachable);
    assert.equal(result.selected?.score, 89);
    assert.equal(result.evaluations.find((evaluation) => evaluation.intention === highest)?.status, "unreachable");
    assert.equal(result.evaluations.find((evaluation) => evaluation.intention === sameComponent)?.status, "refined");
});
test("known unreachable targets are skipped until the world changes", async () => {
    const blocked = new FixedRewardIntention("blocked", new Position(3, 0), 100);
    const planner = new RecordingPDDLPlanner(new Map());
    const refiner = new IntentionRefiner(planner, {
        feasibleCandidateLimit: 1,
        planningBudgetMilliseconds: 1000,
    });
    const context = makeContext(new ConfigurablePathfinder(new Map()));
    const evaluations = [optimisticEvaluation(blocked)];
    await refiner.refine(evaluations, context);
    await refiner.refine(evaluations, context);
    assert.deepEqual(planner.requestedTargets, ["3,0"]);
    await refiner.refine(evaluations, {
        ...context,
        crates: new Map([
            ["moved-wall", new Position(1, 0)],
        ]),
    });
    assert.deepEqual(planner.requestedTargets, ["3,0", "3,0"]);
});
//# sourceMappingURL=_intention-refinement.test.js.map