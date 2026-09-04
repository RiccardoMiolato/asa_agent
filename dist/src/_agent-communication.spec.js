import { strict as assert } from "node:assert";
import test from "node:test";
import { AGENT_COMMUNICATION_SEND_STATUS, AGENT_ROLE, AgentCommunicationMessageFactory, AgentCommunicationMessageParser, DeliverooAgentCommunicationChannel, PEER_CONNECTION_STATE, PEER_MESSAGE_TYPE, PeerHandshakeService, } from "./communication/index.js";
import { PeerRendezvousCoordinator, RENDEZVOUS_COORDINATION_STATE, } from "./llm/tools/rendezvous/index.js";
import { Position } from "./utils/position.js";
/** In-memory Socket.io message bus used by communication contract tests. */
class FakeCommunicationNetwork {
    constructor() {
        this.sockets = new Map();
    }
    add(socket) {
        this.sockets.set(socket.id, socket);
    }
    connect(firstId, secondId) {
        const first = this.requiredSocket(firstId);
        const second = this.requiredSocket(secondId);
        first.announce("connected", second.description());
        second.announce("connected", first.description());
    }
    disconnect(firstId, secondId) {
        const first = this.requiredSocket(firstId);
        const second = this.requiredSocket(secondId);
        first.announce("disconnected", second.description());
        second.announce("disconnected", first.description());
    }
    deliver(sender, recipientId, message) {
        const recipient = this.sockets.get(recipientId);
        if (!recipient) {
            return "failed";
        }
        recipient.receive(sender.id, sender.name, message);
        return "successful";
    }
    requiredSocket(id) {
        const socket = this.sockets.get(id);
        if (!socket) {
            throw new Error(`Unknown fake socket: ${id}`);
        }
        return socket;
    }
}
/** Minimal third-party socket implementation for deterministic tests. */
class FakeCommunicationSocket {
    constructor(id, name, network) {
        this.id = id;
        this.name = name;
        this.network = network;
        network.add(this);
    }
    onAgentConnected(callback) {
        this.controllerHandler = callback;
    }
    onMsg(callback) {
        this.messageHandler = callback;
    }
    async emitSay(recipientId, message) {
        return this.network.deliver(this, recipientId, message);
    }
    announce(status, agent) {
        this.controllerHandler?.(status, agent);
    }
    receive(senderId, senderName, message) {
        this.messageHandler?.(senderId, senderName, message);
    }
    description() {
        return {
            id: this.id,
            name: this.name,
            teamId: "team",
            teamName: "test-team",
            score: 0,
        };
    }
}
/** Repeatedly checks an asynchronous condition within a strict test deadline. */
class AsyncConditionWaiter {
    static async waitUntil(condition, timeoutMilliseconds = 200) {
        const deadline = Date.now() + timeoutMilliseconds;
        while (!condition()) {
            if (Date.now() >= deadline) {
                throw new Error("Timed out waiting for asynchronous condition");
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
}
test("peer messages are versioned and reject malformed payloads", () => {
    const hello = AgentCommunicationMessageFactory.hello(AGENT_ROLE.LLM);
    const assignment = AgentCommunicationMessageFactory.rendezvousAssignment("mission-1", 500, { x: 2, y: 1 }, { x: 2, y: 2 });
    assert.deepEqual(AgentCommunicationMessageParser.parse(hello), hello);
    assert.deepEqual(AgentCommunicationMessageParser.parse(assignment), assignment);
    assert.equal(AgentCommunicationMessageParser.parse({
        ...hello,
        protocolVersion: 99,
    }), undefined);
    assert.equal(AgentCommunicationMessageParser.parse({
        ...assignment,
        bdiAgentTarget: { x: 2.5, y: 2 },
    }), undefined);
    assert.equal(AgentCommunicationMessageParser.parse("ordinary chat mission"), undefined);
});
test("channel isolates peer protocol messages from ordinary chat", async () => {
    const network = new FakeCommunicationNetwork();
    const llmSocket = new FakeCommunicationSocket("llm-id", "llm-agent", network);
    const bdiSocket = new FakeCommunicationSocket("bdi-id", "bdi-agent", network);
    const llmChannel = new DeliverooAgentCommunicationChannel(llmSocket, "bdi-agent");
    const bdiChannel = new DeliverooAgentCommunicationChannel(bdiSocket, "llm-agent");
    const ordinaryMessages = [];
    const peerMessages = [];
    llmChannel.start((_sender, message) => {
        ordinaryMessages.push(message);
    });
    bdiChannel.start(() => { });
    llmChannel.subscribe((_peer, message) => {
        peerMessages.push(message);
    });
    network.connect("llm-id", "bdi-id");
    llmSocket.receive("mission-id", "mission-control", "collect 3 parcels");
    const hello = AgentCommunicationMessageFactory.hello(AGENT_ROLE.BDI);
    const status = await bdiChannel.send(hello);
    await AsyncConditionWaiter.waitUntil(() => peerMessages.length > 0);
    assert.equal(status, AGENT_COMMUNICATION_SEND_STATUS.SENT);
    assert.deepEqual(ordinaryMessages, ["collect 3 parcels"]);
    assert.deepEqual(peerMessages, [hello]);
});
test("two peers establish bidirectional readiness over the message bus", async () => {
    const network = new FakeCommunicationNetwork();
    const llmSocket = new FakeCommunicationSocket("llm-id", "llm-agent", network);
    const bdiSocket = new FakeCommunicationSocket("bdi-id", "bdi-agent", network);
    const llmChannel = new DeliverooAgentCommunicationChannel(llmSocket, "bdi-agent");
    const bdiChannel = new DeliverooAgentCommunicationChannel(bdiSocket, "llm-agent");
    llmChannel.start(() => { });
    bdiChannel.start(() => { });
    const llmHandshake = new PeerHandshakeService(llmChannel, AGENT_ROLE.LLM, 5);
    const bdiHandshake = new PeerHandshakeService(bdiChannel, AGENT_ROLE.BDI, 5);
    llmHandshake.start();
    bdiHandshake.start();
    network.connect("llm-id", "bdi-id");
    await AsyncConditionWaiter.waitUntil(() => llmHandshake.state() === PEER_CONNECTION_STATE.READY
        && bdiHandshake.state() === PEER_CONNECTION_STATE.READY);
    assert.equal(llmHandshake.state(), PEER_CONNECTION_STATE.READY);
    assert.equal(bdiHandshake.state(), PEER_CONNECTION_STATE.READY);
    network.disconnect("llm-id", "bdi-id");
    assert.equal(llmHandshake.state(), PEER_CONNECTION_STATE.CONNECTING);
    assert.equal(bdiHandshake.state(), PEER_CONNECTION_STATE.CONNECTING);
    network.connect("llm-id", "bdi-id");
    await AsyncConditionWaiter.waitUntil(() => llmHandshake.state() === PEER_CONNECTION_STATE.READY
        && bdiHandshake.state() === PEER_CONNECTION_STATE.READY);
    llmHandshake.stop();
    bdiHandshake.stop();
});
test("rendezvous completion is independent of arrival-message order", async () => {
    const network = new FakeCommunicationNetwork();
    const llmSocket = new FakeCommunicationSocket("llm-id", "llm-agent", network);
    const bdiSocket = new FakeCommunicationSocket("bdi-id", "bdi-agent", network);
    const llmChannel = new DeliverooAgentCommunicationChannel(llmSocket, "bdi-agent");
    const bdiChannel = new DeliverooAgentCommunicationChannel(bdiSocket, "llm-agent");
    llmChannel.start(() => { });
    bdiChannel.start(() => { });
    const llmCoordinator = new PeerRendezvousCoordinator(llmChannel, AGENT_ROLE.LLM, 5);
    const bdiCoordinator = new PeerRendezvousCoordinator(bdiChannel, AGENT_ROLE.BDI, 5);
    const rendezvousMessages = [];
    llmChannel.subscribe((_peer, message) => {
        if (message.type === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED
            || message.type
                === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT) {
            rendezvousMessages.push(message);
        }
    });
    bdiChannel.subscribe((_peer, message) => {
        if (message.type === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED
            || message.type
                === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT) {
            rendezvousMessages.push(message);
        }
    });
    llmCoordinator.start();
    bdiCoordinator.start();
    network.connect("llm-id", "bdi-id");
    const llmTarget = new Position(2, 1);
    const bdiTarget = new Position(2, 2);
    llmCoordinator.propose({
        rendezvousId: "mission-1",
        reward: 500,
        llmAgentTarget: llmTarget,
        bdiAgentTarget: bdiTarget,
    });
    await AsyncConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.state
        === RENDEZVOUS_COORDINATION_STATE.COMMITTED
        && bdiCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMMITTED);
    assert.equal(llmCoordinator.activeScoreEffects()[0]?.score, 500);
    assert.equal(llmCoordinator.activeScoreEffects()[0]?.cell.isEqual(llmTarget), true);
    assert.equal(bdiCoordinator.activeScoreEffects()[0]?.score, 500);
    assert.equal(bdiCoordinator.activeScoreEffects()[0]?.cell.isEqual(bdiTarget), true);
    bdiCoordinator.observePosition(bdiTarget);
    await AsyncConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.peerArrived === true);
    assert.equal(bdiCoordinator.snapshots()[0]?.state, RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER);
    assert.equal(llmCoordinator.snapshots()[0]?.state, RENDEZVOUS_COORDINATION_STATE.COMMITTED);
    llmCoordinator.observePosition(llmTarget);
    await AsyncConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.state
        === RENDEZVOUS_COORDINATION_STATE.COMPLETED
        && bdiCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMPLETED);
    assert.deepEqual(llmCoordinator.activeScoreEffects(), []);
    assert.deepEqual(bdiCoordinator.activeScoreEffects(), []);
    assert.deepEqual(llmCoordinator.consumeCompletedRendezvousIds(), ["mission-1"]);
    assert.deepEqual(bdiCoordinator.consumeCompletedRendezvousIds(), ["mission-1"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(rendezvousMessages.filter((message) => message.type === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED).length, 2);
    assert.equal(rendezvousMessages.filter((message) => message.type
        === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT).length, 2);
    llmCoordinator.stop();
    bdiCoordinator.stop();
});
//# sourceMappingURL=_agent-communication.spec.js.map