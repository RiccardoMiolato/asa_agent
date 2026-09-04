import assert from "node:assert/strict";
import test from "node:test";
import { BasePathfinder } from "./astar.js";
import { BELIEF_CHANGE_TYPE, Beliefs, } from "./beliefs.js";
import { ConsoleAgentLogger, DELIBERATION_CYCLE_REASON, } from "./_logging.js";
import { BaseBranchAndBoundGraphWriter, BranchAndBoundSvgRenderer, } from "./_branch-and-bound-svg.js";
import { Action, ActionFactory, } from "./move.js";
import { OPTION_BRANCH_DECISION, OPTION_TRAVERSABILITY, OptionEvaluator, } from "./option_evaluator.js";
import { DESIRE_TYPE, DesireGenerator } from "./desires.js";
import { Position } from "./position.js";
/** Inert action used only to represent one path step. */
class NoOpAction extends Action {
    async execute() {
        return true;
    }
}
/** Manhattan-distance pathfinder sufficient for evaluator timing tests. */
class ManhattanPathfinder extends BasePathfinder {
    findPath(_gameMap, startingPosition, targetPosition, _crates) {
        return Array.from({ length: startingPosition.distanceTo(targetPosition) }, () => new NoOpAction());
    }
}
/** Exposes direct, crate-relaxed, and unreachable evaluator edges. */
class MixedTraversabilityPathfinder extends BasePathfinder {
    findPath(_gameMap, startingPosition, targetPosition, crates) {
        if (targetPosition.x === 3) {
            return [];
        }
        if (targetPosition.x === 2 && crates.size > 0) {
            return [];
        }
        return Array.from({ length: startingPosition.distanceTo(targetPosition) }, () => new NoOpAction());
    }
}
/** Prevents console-format tests from touching the filesystem. */
class PendingGraphWriter extends BaseBranchAndBoundGraphWriter {
    writeGraphs(_agentId, _cycle, _graphs) {
        return new Promise(() => { });
    }
}
/** Game-client stub required by the action factory. */
class NoOpGameClient {
    async emitMove(_direction) {
        return false;
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown() {
        return [];
    }
}
/** Creates fully typed contexts with one pickup and one delivery leg. */
class OptionEvaluatorFixture {
    static context(rewardDecayInterval, reward = 4) {
        const parcel = {
            id: "parcel-1",
            x: 1,
            y: 0,
            reward,
            carriedBy: undefined,
            lastUpdate: new Date(),
        };
        return {
            gameMap: [["1"]],
            agentPosition: new Position(0, 0),
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells: [new Position(2, 0)],
            parcels: new Map([[parcel.id, parcel]]),
            movementDuration: 500,
            frameDuration: 100,
            observationDistance: 5,
            rewardDecayInterval,
            millisecondsUntilNextRewardDecay: rewardDecayInterval,
            agentId: "agent-1",
            pathfinder: new ManhattanPathfinder(),
            actionFactory: new ActionFactory(new NoOpGameClient(), new Beliefs()),
        };
    }
}
test("option scores use action duration and configured decay ticks", () => {
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(OptionEvaluatorFixture.context(1000));
    const sequence = evaluation.bestSequence;
    assert.equal(sequence.length, 2);
    assert.equal(sequence[0].type, "pick");
    assert.equal(sequence[1].type, "drop");
    assert.equal(evaluation.graph.bestScore, 1);
});
test("option scores preserve rewards when decay is disabled", () => {
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(OptionEvaluatorFixture.context(undefined));
    assert.equal(evaluation.graph.bestScore, 4);
});
test("the evaluator stops instead of executing a zero-gain route", () => {
    const sequence = new OptionEvaluator(new DesireGenerator()).evaluate(OptionEvaluatorFixture.context(1000, 1));
    assert.deepEqual(sequence, []);
});
test("excluding a failed delivery root exposes another delivery cell", () => {
    const context = OptionEvaluatorFixture.context(undefined);
    const carriedParcel = {
        ...context.parcels.get("parcel-1"),
        x: 0,
        carriedBy: context.agentId,
    };
    const deliveryCells = [new Position(1, 0), new Position(3, 0)];
    const carriedContext = {
        ...context,
        deliveringCells: deliveryCells,
        parcels: new Map([[carriedParcel.id, carriedParcel]]),
    };
    const evaluator = new OptionEvaluator(new DesireGenerator());
    const preferredSequence = evaluator.evaluate(carriedContext);
    assert.deepEqual(preferredSequence[0].targetCell, deliveryCells[0]);
    const fallbackSequence = evaluator.evaluate(carriedContext, new Set([preferredSequence[0].identity()]));
    assert.deepEqual(fallbackSequence[0].targetCell, deliveryCells[1]);
});
test("delivery choices keep only the nearest cell and each pickup-path detour", () => {
    const baseContext = OptionEvaluatorFixture.context(undefined);
    const freeParcel = {
        ...baseContext.parcels.get("parcel-1"),
        x: 6,
    };
    const carriedParcel = {
        ...freeParcel,
        id: "carried-parcel",
        x: 0,
        carriedBy: baseContext.agentId,
    };
    const nearestDeliveryCell = new Position(0, 1);
    const pickupPathDeliveryCell = new Position(3, 0);
    const irrelevantDeliveryCell = new Position(0, 5);
    const context = {
        ...baseContext,
        deliveringCells: [
            nearestDeliveryCell,
            pickupPathDeliveryCell,
            irrelevantDeliveryCell,
        ],
        parcels: new Map([
            [freeParcel.id, freeParcel],
            [carriedParcel.id, carriedParcel],
        ]),
    };
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const rootDeliveryTargets = evaluation.graph.edges
        .filter((edge) => edge.sourceNodeId === evaluation.graph.rootNodeId
        && edge.optionType === "drop")
        .map((edge) => edge.targetPosition);
    assert.deepEqual(rootDeliveryTargets, [nearestDeliveryCell, pickupPathDeliveryCell]);
});
test("the evaluation graph explains every root action and its traversability", () => {
    const baseContext = OptionEvaluatorFixture.context(undefined);
    const crateRelaxedParcel = {
        ...baseContext.parcels.get("parcel-1"),
        id: "crate-relaxed",
        x: 2,
    };
    const unreachableParcel = {
        ...crateRelaxedParcel,
        id: "unreachable",
        x: 3,
    };
    const context = {
        ...baseContext,
        parcels: new Map([
            [crateRelaxedParcel.id, crateRelaxedParcel],
            [unreachableParcel.id, unreachableParcel],
        ]),
        crates: new Map([["crate-1", new Position(1, 0)]]),
        pathfinder: new MixedTraversabilityPathfinder(),
    };
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const rootEdges = evaluation.graph.edges.filter((edge) => edge.sourceNodeId === evaluation.graph.rootNodeId);
    const crateRelaxedEdge = rootEdges.find((edge) => edge.optionIdentity === "pick:crate-relaxed");
    const unreachableEdge = rootEdges.find((edge) => edge.optionIdentity === "pick:unreachable");
    assert.equal(rootEdges.length, 2);
    assert.equal(crateRelaxedEdge?.traversability, OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING);
    assert.equal(crateRelaxedEdge?.decision, OPTION_BRANCH_DECISION.SELECTED);
    assert.equal(unreachableEdge?.traversability, OPTION_TRAVERSABILITY.UNREACHABLE);
    assert.equal(unreachableEdge?.decision, OPTION_BRANCH_DECISION.UNREACHABLE);
    assert.equal(unreachableEdge?.targetNodeId, undefined);
});
test("the console graph summarizes the winner and executable validation", () => {
    const context = OptionEvaluatorFixture.context(undefined);
    const evaluation = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context);
    const output = [];
    const originalConsoleLog = console.log;
    console.log = (...values) => {
        output.push(values.map(String).join(" "));
    };
    try {
        new ConsoleAgentLogger(new PendingGraphWriter()).logBranchAndBound({
            cycle: 7,
            cycleReason: DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED,
            beliefChanges: [{
                    type: BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED,
                    parcelId: "parcel-1",
                    previousReward: 5,
                    currentReward: 4,
                }],
            agentId: "agent-1",
            position: context.agentPosition,
            evaluationPasses: [evaluation.graph],
            planningAttempts: [{
                    optionIdentity: "pick:parcel-1",
                    optionType: DESIRE_TYPE.PICK_UP,
                    parcelId: "parcel-1",
                    targetPosition: new Position(1, 0),
                    estimatedTraversability: OPTION_TRAVERSABILITY.DIRECT,
                    result: "planned",
                    planner: "astar",
                    plannedActions: 2,
                    reason: "route-found",
                }],
            outcome: "planned",
            planSource: "option",
            plannedActions: 2,
        });
    }
    finally {
        console.log = originalConsoleLog;
    }
    const renderedLog = output.join("\n");
    assert.match(renderedLog, /TURN 7 \| BRANCH-AND-BOUND/);
    assert.match(renderedLog, /START REASON \| BELIEFS CHANGED/);
    assert.match(renderedLog, /parcel parcel-1 reward: 5 -> 4/);
    assert.match(renderedLog, /ROUTE \| PICK parcel-1 -> DROP \(2,0\)/);
    assert.match(renderedLog, /EXECUTABLE PLAN VALIDATION/);
    assert.match(renderedLog, /PLANNED planner=ASTAR/);
    assert.match(renderedLog, /generating one zoomable tree/);
    assert.match(renderedLog, /END TURN 7/);
});
test("the vector graph contains actions, traversal, and selected-path styling", () => {
    const context = OptionEvaluatorFixture.context(undefined);
    const graph = new OptionEvaluator(new DesireGenerator()).evaluateWithGraph(context).graph;
    const svg = new BranchAndBoundSvgRenderer().render(graph, {
        agentId: "agent-1",
        cycle: 7,
        pass: 1,
    });
    assert.match(svg, /<svg/);
    assert.match(svg, /PICK parcel-1/);
    assert.match(svg, /DIRECT/);
    assert.match(svg, /final selected path/);
    assert.match(svg, /stroke="#16a34a"/);
});
//# sourceMappingURL=_option-evaluator.test.js.map