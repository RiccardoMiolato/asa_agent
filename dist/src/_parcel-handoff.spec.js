import { strict as assert } from "node:assert";
import test from "node:test";
import { Beliefs } from "./bdi/beliefs.js";
import { AGENT_COMMUNICATION_SEND_STATUS, AGENT_ROLE, AgentCommunicationMessageFactory, AgentCommunicationMessageParser, BaseAgentCommunicationChannel, } from "./communication/index.js";
import { BalancedSurvivableParcelHandoffCandidateSelector, BaseParcelHandoffCandidateSelector, PARCEL_HANDOFF_STATE, PeerParcelHandoffCoordinator, } from "./llm/tools/handoff/index.js";
import { AStarPathfinder } from "./utils/astar.js";
import { GameMap } from "./utils/map.js";
import { ActionFactory } from "./utils/move.js";
import { Position } from "./utils/position.js";
class HandoffTestGameClient {
    constructor() {
        this.putdownSelections = [];
    }
    async emitMove() {
        return false;
    }
    async emitPickup() {
        return [];
    }
    async emitPutdown(selected) {
        this.putdownSelections.push(selected);
        return [];
    }
    async emitSay() {
        return "successful";
    }
}
test("handoff putdown keeps the selected parcel as free local belief", async () => {
    const client = new HandoffTestGameClient();
    const beliefs = new Beliefs();
    const parcel = {
        id: "parcel-drop",
        x: 0,
        y: 0,
        reward: 10,
        carriedBy: "llm-id",
        lastUpdate: new Date(),
    };
    beliefs.parcels.set(parcel.id, parcel);
    const handoffCell = new Position(2, 3);
    const succeeded = await new ActionFactory(client, beliefs)
        .putDownForHandoff(parcel.id, "llm-id", handoffCell)
        .execute();
    assert.equal(succeeded, true);
    assert.deepEqual(client.putdownSelections, [[parcel.id]]);
    assert.equal(beliefs.parcels.get(parcel.id)?.carriedBy, undefined);
    assert.equal(beliefs.parcels.get(parcel.id)?.x, handoffCell.x);
    assert.equal(beliefs.parcels.get(parcel.id)?.y, handoffCell.y);
});
test("parcel handoff messages round-trip through boundary validation", () => {
    const request = AgentCommunicationMessageFactory.parcelHandoffRequest("mission-wire", 200);
    const status = AgentCommunicationMessageFactory.parcelHandoffStatus("mission-wire", request.messageId, new Position(0, 0));
    const assignment = AgentCommunicationMessageFactory.parcelHandoffAssignment("mission-wire", 200, "parcel-wire", new Position(1, 1), new Position(1, 2), new Position(1, 0), new Position(2, 1));
    const ready = AgentCommunicationMessageFactory.parcelHandoffReady("mission-wire", "parcel-wire", new Position(1, 2));
    const readyAcknowledgement = AgentCommunicationMessageFactory
        .parcelHandoffReadyAcknowledgement("mission-wire", "parcel-wire", ready.messageId);
    const available = AgentCommunicationMessageFactory.parcelHandoffAvailable("mission-wire", "parcel-wire", new Position(1, 1));
    const collected = AgentCommunicationMessageFactory.parcelHandoffCollected("mission-wire", "parcel-wire");
    const delivered = AgentCommunicationMessageFactory.parcelHandoffDelivered("mission-wire", "parcel-wire");
    for (const message of [
        request,
        status,
        assignment,
        ready,
        readyAcknowledgement,
        available,
        collected,
        delivered,
    ]) {
        assert.deepEqual(AgentCommunicationMessageParser.parse(message), message);
    }
    assert.equal(AgentCommunicationMessageParser.parse({
        ...assignment,
        stagingCell: { x: 1.5, y: 2 },
    }), undefined);
});
class HandoffTestContextFactory {
    static make(gameMap, agentId, agentPosition, parcels, deliveringCells, sensedAgents = new Map(), rewardDecayInterval = 1000) {
        const client = new HandoffTestGameClient();
        const actionFactory = new ActionFactory(client, new Beliefs());
        return {
            gameMap,
            agentPosition,
            crates: new Map(),
            pickupCells: [],
            pickupCellLastObservedAt: new Map(),
            deliveringCells,
            parcels,
            pickupExcludedParcelIds: new Set(),
            sensedAgents,
            movementDuration: 100,
            frameDuration: 0,
            observationDistance: 2,
            rewardDecayInterval,
            millisecondsUntilNextRewardDecay: rewardDecayInterval,
            agentId,
            pathfinder: new AStarPathfinder(actionFactory),
            actionFactory,
            cellScoreEffects: [],
            deliveryScoreEffects: [],
        };
    }
}
test("handoff selection rejects parcels that cannot survive the route", () => {
    const gameMap = new GameMap([
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "2"],
    ]);
    const parcel = {
        id: "expiring",
        x: 2,
        y: 2,
        reward: 2,
        carriedBy: undefined,
        lastUpdate: new Date(),
    };
    const planning = HandoffTestContextFactory.make(gameMap, "llm-id", new Position(0, 0), new Map([[parcel.id, parcel]]), [new Position(4, 4)]);
    const selected = new BalancedSurvivableParcelHandoffCandidateSelector()
        .select({ planning, bdiAgentPosition: new Position(4, 0) });
    assert.equal(selected, undefined);
});
test("handoff selection returns a survivable route with safe geometry", () => {
    const gameMap = new GameMap([
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "1"],
        ["1", "1", "1", "1", "2"],
    ]);
    const parcel = {
        id: "survivor",
        x: 2,
        y: 2,
        reward: 100,
        carriedBy: undefined,
        lastUpdate: new Date(),
    };
    const planning = HandoffTestContextFactory.make(gameMap, "llm-id", new Position(0, 0), new Map([[parcel.id, parcel]]), [new Position(4, 4)]);
    const selected = new BalancedSurvivableParcelHandoffCandidateSelector()
        .select({ planning, bdiAgentPosition: new Position(4, 0) });
    assert.equal(selected?.parcelId, parcel.id);
    assert.ok((selected?.estimatedRewardAtDelivery ?? 0) > 0);
    assert.equal(selected?.handoffCell.distanceTo(selected.stagingCell), 1);
    assert.equal(selected?.handoffCell.distanceTo(selected.escapeCell), 1);
    assert.equal(selected?.stagingCell.isEqual(selected.escapeCell), false);
});
test("handoff selection requires distinct staging and escape cells", () => {
    const gameMap = new GameMap([
        ["0", "0", "0"],
        ["0", "1", "1"],
        ["0", "0", "2"],
    ]);
    const parcel = {
        id: "dead-end",
        x: 1,
        y: 1,
        reward: 100,
        carriedBy: undefined,
        lastUpdate: new Date(),
    };
    const planning = HandoffTestContextFactory.make(gameMap, "llm-id", new Position(1, 2), new Map([[parcel.id, parcel]]), [new Position(2, 2)], new Map(), undefined);
    const selected = new BalancedSurvivableParcelHandoffCandidateSelector()
        .select({ planning, bdiAgentPosition: new Position(1, 2) });
    assert.equal(selected, undefined);
});
class FixedHandoffSelector extends BaseParcelHandoffCandidateSelector {
    constructor(candidate) {
        super();
        this.candidate = candidate;
    }
    select(_context) {
        return this.candidate;
    }
}
class HandoffTestChannel extends BaseAgentCommunicationChannel {
    constructor(localPeer) {
        super();
        this.localPeer = localPeer;
    }
    connect(counterpart) {
        this.counterpart = counterpart;
    }
    start(_handler) { }
    async send(message) {
        if (!this.counterpart) {
            return AGENT_COMMUNICATION_SEND_STATUS.PEER_UNAVAILABLE;
        }
        await this.counterpart.receive(this.localPeer, message);
        return AGENT_COMMUNICATION_SEND_STATUS.SENT;
    }
    peer() {
        return this.counterpart?.localPeer;
    }
    async receive(sender, message) {
        await this.publish(sender, message);
    }
}
class HandoffConditionWaiter {
    static async until(condition) {
        const deadline = Date.now() + 250;
        while (!condition()) {
            if (Date.now() >= deadline) {
                throw new Error("Timed out waiting for parcel handoff state");
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
}
test("ready handshaking precedes release, collection, and delivery", async () => {
    const handoffCell = new Position(1, 1);
    const stagingCell = new Position(1, 2);
    const escapeCell = new Position(1, 0);
    const deliveryCell = new Position(2, 1);
    const candidate = {
        parcelId: "parcel-1",
        parcelReward: 20,
        handoffCell,
        stagingCell,
        escapeCell,
        deliveryCell,
        llmMovementSteps: 1,
        bdiMovementSteps: 2,
        pathImbalanceMilliseconds: 100,
        estimatedCompletionMilliseconds: 1000,
        estimatedRewardAtDelivery: 19,
    };
    const llmChannel = new HandoffTestChannel({
        id: "llm-id",
        name: "llm",
    });
    const bdiChannel = new HandoffTestChannel({
        id: "bdi-id",
        name: "bdi",
    });
    llmChannel.connect(bdiChannel);
    bdiChannel.connect(llmChannel);
    const llmCoordinator = new PeerParcelHandoffCoordinator(llmChannel, AGENT_ROLE.LLM, new FixedHandoffSelector(candidate), 10);
    const bdiCoordinator = new PeerParcelHandoffCoordinator(bdiChannel, AGENT_ROLE.BDI, new FixedHandoffSelector(candidate), 10);
    const map = new GameMap([
        ["1", "1", "1"],
        ["1", "1", "1"],
        ["1", "2", "1"],
    ]);
    const freeParcel = {
        id: candidate.parcelId,
        x: handoffCell.x,
        y: handoffCell.y,
        reward: candidate.parcelReward,
        carriedBy: undefined,
        lastUpdate: new Date(),
    };
    llmCoordinator.start();
    bdiCoordinator.start();
    llmCoordinator.observePosition(new Position(0, 1));
    bdiCoordinator.observePosition(stagingCell);
    try {
        llmCoordinator.activate("mission-handoff", 200);
        await HandoffConditionWaiter.until(() => bdiCoordinator.snapshot()?.state
            === PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT);
        const llmSelectingContext = HandoffTestContextFactory.make(map, "llm-id", new Position(0, 1), new Map([[freeParcel.id, freeParcel]]), [deliveryCell]);
        llmCoordinator.refresh(llmSelectingContext);
        await HandoffConditionWaiter.until(() => bdiCoordinator.snapshot()?.state
            === PARCEL_HANDOFF_STATE.MOVING_TO_STAGING);
        const llmCarriedParcel = {
            ...freeParcel,
            carriedBy: "llm-id",
        };
        llmCoordinator.observePosition(handoffCell);
        llmCoordinator.refresh(HandoffTestContextFactory.make(map, "llm-id", handoffCell, new Map([[llmCarriedParcel.id, llmCarriedParcel]]), [deliveryCell], new Map([["bdi-id", {
                    id: "bdi-id",
                    name: "bdi",
                    teamId: "team",
                    teamName: "test-team",
                    score: 0,
                    penalty: 0,
                    x: stagingCell.x,
                    y: stagingCell.y,
                }]])));
        bdiCoordinator.refresh(HandoffTestContextFactory.make(map, "bdi-id", stagingCell, new Map(), [deliveryCell]));
        await HandoffConditionWaiter.until(() => llmCoordinator.snapshot()?.state
            === PARCEL_HANDOFF_STATE.WAITING_FOR_READY);
        llmCoordinator.refresh(HandoffTestContextFactory.make(map, "llm-id", handoffCell, new Map([[llmCarriedParcel.id, llmCarriedParcel]]), [deliveryCell], new Map([["bdi-id", {
                    id: "bdi-id",
                    name: "bdi",
                    teamId: "team",
                    teamName: "test-team",
                    score: 0,
                    penalty: 0,
                    x: stagingCell.x,
                    y: stagingCell.y,
                }]])));
        assert.equal(llmCoordinator.snapshot()?.state, PARCEL_HANDOFF_STATE.RELEASING);
        const release = llmCoordinator.instruction(llmSelectingContext);
        assert.equal(release?.type, "release");
        if (!release) {
            throw new Error("Missing release instruction");
        }
        llmCoordinator.completeInstruction(release, HandoffTestContextFactory.make(map, "llm-id", escapeCell, new Map([[freeParcel.id, freeParcel]]), [deliveryCell]));
        await HandoffConditionWaiter.until(() => bdiCoordinator.snapshot()?.state
            === PARCEL_HANDOFF_STATE.COLLECTING);
        const collect = bdiCoordinator.instruction(HandoffTestContextFactory.make(map, "bdi-id", stagingCell, new Map([[freeParcel.id, freeParcel]]), [deliveryCell]));
        assert.equal(collect?.type, "collect");
        if (!collect) {
            throw new Error("Missing collection instruction");
        }
        const bdiCarriedParcel = {
            ...freeParcel,
            carriedBy: "bdi-id",
        };
        bdiCoordinator.completeInstruction(collect, HandoffTestContextFactory.make(map, "bdi-id", handoffCell, new Map([[bdiCarriedParcel.id, bdiCarriedParcel]]), [deliveryCell]));
        assert.equal(bdiCoordinator.snapshot()?.state, PARCEL_HANDOFF_STATE.DELIVERING);
        const deliver = bdiCoordinator.instruction(HandoffTestContextFactory.make(map, "bdi-id", handoffCell, new Map([[bdiCarriedParcel.id, bdiCarriedParcel]]), [deliveryCell]));
        assert.equal(deliver?.type, "deliver");
        if (!deliver) {
            throw new Error("Missing delivery instruction");
        }
        bdiCoordinator.completeInstruction(deliver, HandoffTestContextFactory.make(map, "bdi-id", deliveryCell, new Map(), [deliveryCell]));
        await HandoffConditionWaiter.until(() => llmCoordinator.snapshot()?.state
            === PARCEL_HANDOFF_STATE.COMPLETED);
        assert.deepEqual(llmCoordinator.consumeCompletedHandoffIds(), ["mission-handoff"]);
    }
    finally {
        llmCoordinator.stop();
        bdiCoordinator.stop();
    }
});
//# sourceMappingURL=_parcel-handoff.spec.js.map