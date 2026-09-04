import { strict as assert } from "node:assert";
import test from "node:test";
import { AGENT_COMMUNICATION_SEND_STATUS, AGENT_ROLE, AgentCommunicationMessageFactory, AgentCommunicationMessageParser, BaseAgentCommunicationChannel, } from "./communication/index.js";
import { GRID_COORDINATE_PARITY, GridPositionObjective, PeerRendezvousCoordinator, RENDEZVOUS_COORDINATION_STATE, } from "./llm/tools/rendezvous/index.js";
import { Position } from "./utils/position.js";
/** Deterministic in-memory channel for formation protocol tests. */
class GridFormationTestChannel extends BaseAgentCommunicationChannel {
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
/** Polls asynchronous message transitions within a strict deadline. */
class GridFormationConditionWaiter {
    static async until(condition, timeoutMilliseconds = 200) {
        const deadline = Date.now() + timeoutMilliseconds;
        while (!condition()) {
            if (Date.now() >= deadline) {
                throw new Error("Timed out waiting for grid formation state");
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
}
test("grid formation targets are local and wait for an external release", async () => {
    const llmChannel = new GridFormationTestChannel({
        id: "llm-id",
        name: "llm-agent",
    });
    const bdiChannel = new GridFormationTestChannel({
        id: "bdi-id",
        name: "bdi-agent",
    });
    llmChannel.connect(bdiChannel);
    bdiChannel.connect(llmChannel);
    const resolveGridPosition = (objective, currentPosition, excludedPositions) => [
        new Position(currentPosition.x, currentPosition.y - 1),
        new Position(currentPosition.x, currentPosition.y + 1),
    ].find((candidate) => objective.matches(candidate.x, candidate.y)
        && !excludedPositions.some((excluded) => excluded.isEqual(candidate)));
    const llmCoordinator = new PeerRendezvousCoordinator(llmChannel, AGENT_ROLE.LLM, 5, resolveGridPosition);
    const bdiCoordinator = new PeerRendezvousCoordinator(bdiChannel, AGENT_ROLE.BDI, 5, resolveGridPosition);
    llmCoordinator.start();
    bdiCoordinator.start();
    try {
        const initialLlmPosition = new Position(0, 2);
        const currentLlmPosition = new Position(0, 4);
        const llmTarget = new Position(0, 3);
        const bdiStart = new Position(5, 4);
        const bdiTarget = new Position(5, 3);
        const oddRow = new GridPositionObjective(undefined, GRID_COORDINATE_PARITY.ODD);
        llmCoordinator.observePosition(initialLlmPosition);
        bdiCoordinator.observePosition(bdiStart);
        llmCoordinator.considerGridFormation({
            rendezvousId: "mission-formation",
            reward: 700,
            llmAgentObjective: oddRow,
            bdiAgentObjective: oddRow,
        });
        const initialLlmEffect = llmCoordinator.activeScoreEffects()[0];
        assert.equal(initialLlmEffect?.cell.isEqual(new Position(0, 1)), true);
        assert.deepEqual(bdiCoordinator.snapshots(), []);
        llmCoordinator.observePosition(currentLlmPosition);
        const llmEffect = llmCoordinator.activeScoreEffects()[0];
        assert.equal(llmEffect?.cell.isEqual(llmTarget), true);
        assert.equal(llmEffect
            ? llmCoordinator.commitSelectedGridFormation(llmEffect.id, llmEffect.cell)
            : false, true);
        await GridFormationConditionWaiter.until(() => bdiCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.CONSIDERING);
        const bdiEffect = bdiCoordinator.activeScoreEffects()[0];
        assert.equal(bdiEffect?.cell.isEqual(bdiTarget), true);
        assert.equal(bdiEffect
            ? bdiCoordinator.commitSelectedGridFormation(bdiEffect.id, bdiEffect.cell)
            : false, true);
        await GridFormationConditionWaiter.until(() => llmCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMMITTED);
        assert.equal(bdiCoordinator.snapshots()[0]?.localTarget?.isEqual(bdiTarget), true);
        llmCoordinator.observePosition(llmTarget);
        bdiCoordinator.observePosition(bdiTarget);
        await GridFormationConditionWaiter.until(() => llmCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE
            && bdiCoordinator.snapshots()[0]?.state
                === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE);
        assert.equal(llmCoordinator.isWaitingForPeer(), true);
        assert.equal(bdiCoordinator.isWaitingForPeer(), true);
        assert.deepEqual(llmCoordinator.consumeCompletedRendezvousIds(), []);
        assert.equal(llmCoordinator.releaseWaitingGridFormations(), true);
        await GridFormationConditionWaiter.until(() => llmCoordinator.snapshots()[0]?.state
            === RENDEZVOUS_COORDINATION_STATE.COMPLETED
            && bdiCoordinator.snapshots()[0]?.state
                === RENDEZVOUS_COORDINATION_STATE.COMPLETED);
        assert.deepEqual(llmCoordinator.consumeCompletedRendezvousIds(), ["mission-formation"]);
        assert.deepEqual(bdiCoordinator.consumeCompletedRendezvousIds(), ["mission-formation"]);
    }
    finally {
        llmCoordinator.stop();
        bdiCoordinator.stop();
    }
});
test("grid formation wire messages round-trip through validation", () => {
    const oddRow = new GridPositionObjective(undefined, GRID_COORDINATE_PARITY.ODD).describe();
    const proposal = AgentCommunicationMessageFactory.gridFormationProposal("mission-wire", 700, new Position(0, 1), oddRow, oddRow);
    const release = AgentCommunicationMessageFactory.gridFormationRelease("mission-wire");
    assert.deepEqual(AgentCommunicationMessageParser.parse(proposal), proposal);
    assert.deepEqual(AgentCommunicationMessageParser.parse(release), release);
});
//# sourceMappingURL=_grid-formation-coordination-tests.js.map