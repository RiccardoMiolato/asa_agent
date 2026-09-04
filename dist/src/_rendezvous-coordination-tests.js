import { strict as assert } from "node:assert";
import test from "node:test";
import { AGENT_COMMUNICATION_SEND_STATUS, AGENT_ROLE, BaseAgentCommunicationChannel, PEER_MESSAGE_TYPE, } from "./communication/index.js";
import { PeerRendezvousCoordinator, RENDEZVOUS_COORDINATION_STATE, } from "./llm/tools/rendezvous/index.js";
import { Position } from "./utils/position.js";
/** In-memory typed channel for rendezvous state-machine tests. */
class RendezvousTestChannel extends BaseAgentCommunicationChannel {
    constructor(localPeer) {
        super();
        this.localPeer = localPeer;
        this.sentMessages = [];
    }
    connect(counterpart) {
        this.counterpart = counterpart;
        this.counterpartPeer = counterpart.localPeer;
    }
    start(_unhandledHandler) { }
    async send(message) {
        this.sentMessages.push(message);
        if (!this.counterpart) {
            return AGENT_COMMUNICATION_SEND_STATUS.PEER_UNAVAILABLE;
        }
        await this.counterpart.receive(this.localPeer, message);
        return AGENT_COMMUNICATION_SEND_STATUS.SENT;
    }
    peer() {
        return this.counterpartPeer;
    }
    async receive(sender, message) {
        await this.publish(sender, message);
    }
}
/** Waits for an asynchronous state transition within a strict deadline. */
class RendezvousConditionWaiter {
    static async waitUntil(condition, timeoutMilliseconds = 200) {
        const deadline = Date.now() + timeoutMilliseconds;
        while (!condition()) {
            if (Date.now() >= deadline) {
                throw new Error("Timed out waiting for rendezvous state");
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
}
test("completed peers acknowledge arrivals without echoing them", async () => {
    const llmChannel = new RendezvousTestChannel({
        id: "llm-id",
        name: "llm-agent",
    });
    const bdiChannel = new RendezvousTestChannel({
        id: "bdi-id",
        name: "bdi-agent",
    });
    llmChannel.connect(bdiChannel);
    bdiChannel.connect(llmChannel);
    const llmCoordinator = new PeerRendezvousCoordinator(llmChannel, AGENT_ROLE.LLM, 5);
    const bdiCoordinator = new PeerRendezvousCoordinator(bdiChannel, AGENT_ROLE.BDI, 5);
    llmCoordinator.start();
    bdiCoordinator.start();
    try {
        const llmTarget = new Position(1, 1);
        const bdiTarget = new Position(1, 2);
        llmCoordinator.propose({
            rendezvousId: "mission-1",
            reward: 500,
            llmAgentTarget: llmTarget,
            bdiAgentTarget: bdiTarget,
        });
        await RendezvousConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMMITTED);
        bdiCoordinator.observePosition(bdiTarget);
        await RendezvousConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.peerArrived === true);
        llmCoordinator.observePosition(llmTarget);
        await RendezvousConditionWaiter.waitUntil(() => llmCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMPLETED
            && bdiCoordinator.snapshots()[0]?.state
                === RENDEZVOUS_COORDINATION_STATE.COMPLETED);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const messages = [
            ...llmChannel.sentMessages,
            ...bdiChannel.sentMessages,
        ];
        assert.equal(messages.filter((message) => message.type === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED).length, 2);
        assert.equal(messages.filter((message) => message.type
            === PEER_MESSAGE_TYPE
                .RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT).length, 2);
    }
    finally {
        llmCoordinator.stop();
        bdiCoordinator.stop();
    }
});
//# sourceMappingURL=_rendezvous-coordination-tests.js.map