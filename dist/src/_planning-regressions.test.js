import assert from "node:assert/strict";
import test from "node:test";
import { BaseAgentLogger, } from "./_logging.js";
import { Agent, PLAN_BUILD_STATUS } from "./agent.js";
import { AStarPathfinder, BasePathfinder } from "./astar.js";
import { Beliefs } from "./beliefs.js";
import { DesireGenerator, DeliverParcelsDesire, PickUpParcelDesire, } from "./desires.js";
import { SearchIntention } from "./intentions.js";
import { Action, ActionFactory, PickUp, } from "./move.js";
import { OptionEvaluator } from "./option_evaluator.js";
import { PDDLPlanner } from "./pddl/pddlPlanner.js";
import { Position } from "./position.js";
/** Inert action used to represent a navigation step. */
class NoOpAction extends Action {
    async execute() {
        return true;
    }
}
/** Configurable game client for action-confirmation tests. */
class TestGameClient {
    constructor(pickupResult = []) {
        this.pickupResult = pickupResult;
    }
    async emitMove(_direction) {
        return false;
    }
    async emitPickup() {
        return this.pickupResult;
    }
    async emitPutdown() {
        return [];
    }
}
/** Pickup acknowledgement that is empty before sensing confirms ownership. */
class SensingConfirmedPickupClient extends TestGameClient {
    constructor(beliefs, parcel, agentId) {
        super([]);
        this.beliefs = beliefs;
        this.parcel = parcel;
        this.agentId = agentId;
    }
    async emitPickup() {
        setTimeout(() => {
            this.beliefs.reviseWithChanges([{ ...this.parcel, carriedBy: this.agentId }], [], [this.parcel]);
        }, 0);
        return [];
    }
}
/** Logger that deliberately discards test events. */
class NoOpLogger extends BaseAgentLogger {
    logDeliveryGain(_delivery) { }
}
/** Pathfinder whose result changes when the supplied map changes. */
class MapSensitivePathfinder extends BasePathfinder {
    constructor() {
        super(...arguments);
        this.findPathCalls = 0;
    }
    findPath(gameMap, _startingPosition, targetPosition, _crates) {
        this.findPathCalls += 1;
        return gameMap[targetPosition.x][targetPosition.y] === "0"
            ? []
            : [new NoOpAction()];
    }
}
/** Pathfinder that forces navigation to use the PDDL fallback. */
class UnreachablePathfinder extends BasePathfinder {
    findPath(_gameMap, _startingPosition, _targetPosition, _crates) {
        return [];
    }
}
/** Pathfinder with one optimistic crate route and one longer direct route. */
class OptimisticCratePathfinder extends BasePathfinder {
    findPath(_gameMap, startingPosition, targetPosition, crates) {
        if (targetPosition.x === 1 && crates.size > 0) {
            return [];
        }
        return Array.from({ length: startingPosition.distanceTo(targetPosition) }, () => new NoOpAction());
    }
}
/** Search intention whose completion calls can be asserted explicitly. */
class CompletionTrackingSearch extends SearchIntention {
    constructor() {
        super(...arguments);
        this.completionCount = 0;
    }
    onPlanCompleted() {
        this.completionCount += 1;
    }
}
/** Deterministic PDDL planner used to test Agent fallback wiring. */
class StubPddlPlanner extends PDDLPlanner {
    constructor(actionFactory, result) {
        super(actionFactory);
        this.result = result;
    }
    resetPDDL() { }
    buildPDDLProblem(_map, _crates, _playerId, _playerPosition) { }
    buildGoal(_goal) { }
    async solveProblem() {
        return this.result;
    }
}
/** Shared strongly typed context and Agent construction helpers. */
class PlanningFixture {
    constructor() {
        this.beliefs = new Beliefs();
        this.client = new TestGameClient();
        this.actionFactory = new ActionFactory(this.client, this.beliefs);
    }
    context(pathfinder) {
        return {
            gameMap: [["1"], ["1"]],
            agentPosition: new Position(0, 0),
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [],
            parcels: new Map(),
            movementDuration: 0,
            frameDuration: 0,
            observationDistance: 0,
            rewardDecayInterval: undefined,
            millisecondsUntilNextRewardDecay: undefined,
            agentId: "agent-1",
            pathfinder,
            actionFactory: this.actionFactory,
        };
    }
    agent(pathfinder, pddlResult) {
        return new Agent(this.beliefs, new DesireGenerator(), pathfinder, this.actionFactory, new NoOpLogger(), new StubPddlPlanner(this.actionFactory, pddlResult));
    }
}
test("pickup updates beliefs only after the server confirms the target", async () => {
    const parcel = { id: "parcel-1", x: 0, y: 0, reward: 5 };
    const rejectedBeliefs = new Beliefs();
    rejectedBeliefs.senseParcels([parcel]);
    const rejectedPickup = new PickUp(new TestGameClient([]), rejectedBeliefs, parcel.id, "agent-1");
    assert.equal(await rejectedPickup.execute(), false);
    assert.equal(rejectedBeliefs.parcels.get(parcel.id)?.carriedBy, undefined);
    const confirmedBeliefs = new Beliefs();
    confirmedBeliefs.senseParcels([parcel]);
    const confirmedPickup = new PickUp(new TestGameClient([{ id: parcel.id }]), confirmedBeliefs, parcel.id, "agent-1");
    assert.equal(await confirmedPickup.execute(), true);
    assert.equal(confirmedBeliefs.parcels.get(parcel.id)?.carriedBy, "agent-1");
    const sensingConfirmedBeliefs = new Beliefs();
    sensingConfirmedBeliefs.senseParcels([parcel]);
    const sensingConfirmedPickup = new PickUp(new SensingConfirmedPickupClient(sensingConfirmedBeliefs, parcel, "agent-1"), sensingConfirmedBeliefs, parcel.id, "agent-1");
    assert.equal(await sensingConfirmedPickup.execute(), true);
    assert.equal(sensingConfirmedBeliefs.parcels.get(parcel.id)?.carriedBy, "agent-1");
});
test("expected pickup, reward decay, and expiration do not interrupt the plan", () => {
    const fixture = new PlanningFixture();
    const pathfinder = new UnreachablePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    agent.id = "agent-1";
    const controller = agent;
    const parcel = { id: "parcel-1", x: 0, y: 0, reward: 5 };
    fixture.beliefs.reviseWithChanges([parcel], [], [parcel]);
    controller.replacePlan([
        new PickUp(fixture.client, fixture.beliefs, parcel.id, "agent-1"),
    ]);
    const pickupRevision = fixture.beliefs.reviseWithChanges([{ ...parcel, carriedBy: "agent-1" }], [], [parcel]);
    controller.signalBeliefRevision(pickupRevision);
    assert.equal(controller.isBeliefChanged, false);
    const pickupAndDecayRevision = fixture.beliefs.reviseWithChanges([{ ...parcel, carriedBy: "agent-1", reward: 4 }], [], [parcel]);
    controller.signalBeliefRevision(pickupAndDecayRevision);
    assert.equal(controller.isBeliefChanged, false);
    const expirationRevision = fixture.beliefs.reviseWithChanges([{ ...parcel, carriedBy: "agent-1", reward: 0 }], [], [parcel]);
    controller.signalBeliefRevision(expirationRevision);
    assert.equal(controller.isBeliefChanged, false);
    assert.equal(fixture.beliefs.parcels.has(parcel.id), false);
    const disappearingParcel = {
        id: "parcel-2",
        x: 0,
        y: 0,
        reward: 3,
    };
    fixture.beliefs.reviseWithChanges([disappearingParcel], [], [disappearingParcel]);
    const disappearanceRevision = fixture.beliefs.reviseWithChanges([], [], [disappearingParcel]);
    controller.signalBeliefRevision(disappearanceRevision);
    assert.equal(controller.isBeliefChanged, false);
    assert.equal(fixture.beliefs.parcels.has(disappearingParcel.id), false);
});
test("a pickup can continue its evaluated sequence without deliberating", async () => {
    const fixture = new PlanningFixture();
    const pathfinder = new MapSensitivePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    const controller = agent;
    controller.selectedDesireSequence = [
        new DeliverParcelsDesire(new Position(1, 0)),
    ];
    assert.equal(await controller.continueSelectedDesireSequence(fixture.context(pathfinder)), true);
    assert.deepEqual(controller.selectedDesireSequence, []);
});
test("path-length cache entries are separated by map contents", () => {
    const pathfinder = new MapSensitivePathfinder();
    const gameMap = [["1"], ["1"]];
    const start = new Position(0, 0);
    const target = new Position(1, 0);
    const crates = new Map();
    assert.equal(pathfinder.pathLength(gameMap, start, target, crates), 1);
    gameMap[1][0] = "0";
    assert.equal(pathfinder.pathLength(gameMap, start, target, crates), undefined);
    assert.equal(pathfinder.findPathCalls, 2);
});
test("option actions use PDDL and append pickup only after navigation", async () => {
    const fixture = new PlanningFixture();
    const pathfinder = new UnreachablePathfinder();
    const navigationAction = new NoOpAction();
    const agent = fixture.agent(pathfinder, [navigationAction]);
    const builder = agent;
    const actions = await builder.buildActionsFromDesire(new PickUpParcelDesire("parcel-1", new Position(1, 0)), fixture.context(pathfinder));
    assert.equal(actions?.length, 2);
    assert.equal(actions?.[0], navigationAction);
    assert.ok(actions?.[1] instanceof PickUp);
});
test("option actions are absent when both A-star and PDDL fail", async () => {
    const fixture = new PlanningFixture();
    const pathfinder = new UnreachablePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    const builder = agent;
    assert.equal(await builder.buildActionsFromDesire(new PickUpParcelDesire("parcel-1", new Position(1, 0)), fixture.context(pathfinder)), undefined);
});
test("temporary walls keep an infeasible planning pass retryable", async () => {
    const fixture = new PlanningFixture();
    const pathfinder = new UnreachablePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    const temporaryBlockController = agent;
    temporaryBlockController.addTemporaryBlockedCell(new Position(1, 0));
    const context = {
        ...fixture.context(pathfinder),
        pickupCells: [new Position(1, 0)],
    };
    assert.equal(await agent.buildPlan(context), PLAN_BUILD_STATUS.TRANSIENTLY_BLOCKED);
});
test("a failed optimistic delivery falls back to another delivery root", async () => {
    const fixture = new PlanningFixture();
    const pathfinder = new OptimisticCratePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    const carriedParcel = {
        id: "parcel-1",
        x: 0,
        y: 0,
        reward: 5,
        carriedBy: "agent-1",
        lastUpdate: new Date(),
    };
    const context = {
        ...fixture.context(pathfinder),
        gameMap: [["1"], ["1"], ["1"], ["1"]],
        crates: new Map([["crate-1", new Position(1, 0)]]),
        deliveringCells: [new Position(1, 0), new Position(3, 0)],
        parcels: new Map([[carriedParcel.id, carriedParcel]]),
    };
    const controller = agent;
    controller.selectedDesireSequence = new OptionEvaluator(new DesireGenerator()).evaluate(context);
    assert.deepEqual(controller.selectedDesireSequence[0].targetCell, new Position(1, 0));
    assert.equal(await agent.buildPlan(context), PLAN_BUILD_STATUS.PLANNED);
    assert.deepEqual(agent.currentDecision(), {
        type: "deliver",
        target: new Position(3, 0),
    });
});
test("an option plan cannot complete an interrupted intention", () => {
    const fixture = new PlanningFixture();
    const pathfinder = new UnreachablePathfinder();
    const agent = fixture.agent(pathfinder, undefined);
    const controller = agent;
    const interruptedSearch = new CompletionTrackingSearch();
    controller.replacePlan([new NoOpAction()], interruptedSearch);
    controller.replacePlan([new NoOpAction()]);
    controller.completePlan();
    assert.equal(interruptedSearch.completionCount, 0);
});
test("search tries another cluster when the oldest cluster is unreachable", () => {
    const beliefs = new Beliefs();
    const actionFactory = new ActionFactory(new TestGameClient(), beliefs);
    const pathfinder = new AStarPathfinder(actionFactory);
    const gameMap = Array.from({ length: 5 }, () => Array(3).fill("3"));
    gameMap[2][0] = "0";
    const context = {
        ...new PlanningFixture().context(pathfinder),
        gameMap,
        pickupCells: [
            new Position(0, 0),
            new Position(1, 0),
            new Position(2, 0),
            new Position(4, 2),
        ],
        pathfinder,
        actionFactory,
    };
    const search = new SearchIntention();
    const actions = search.buildActions(context);
    assert.ok(actions.length > 0);
    assert.deepEqual(search.describe().target, new Position(4, 2));
});
//# sourceMappingURL=_planning-regressions.test.js.map