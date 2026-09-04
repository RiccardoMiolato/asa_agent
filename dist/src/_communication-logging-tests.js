import { strict as assert } from "node:assert";
import test from "node:test";
import { AGENT_COMMUNICATION_SEND_STATUS, AGENT_ROLE, AgentCommunicationMessageFactory, ConsoleAgentCommunicationLogger, } from "./communication/index.js";
/** Captures console output while preserving the process-wide logger afterwards. */
class ConsoleLogCapture {
    constructor() {
        this.messages = [];
        this.originalLog = console.log;
    }
    start() {
        console.log = (...data) => {
            this.messages.push(data.map(String).join(" "));
        };
    }
    stop() {
        console.log = this.originalLog;
    }
    output() {
        return this.messages;
    }
}
test("console communication logging hides successful handshake frames", () => {
    const logger = new ConsoleAgentCommunicationLogger();
    const capture = new ConsoleLogCapture();
    const hello = AgentCommunicationMessageFactory.hello(AGENT_ROLE.LLM);
    const acknowledgement = AgentCommunicationMessageFactory.helloAcknowledgement(AGENT_ROLE.BDI, hello.messageId);
    capture.start();
    try {
        logger.log({
            event: "message-sent",
            peerId: "peer-id",
            message: hello,
            status: AGENT_COMMUNICATION_SEND_STATUS.SENT,
        });
        logger.log({
            event: "message-received",
            peerId: "peer-id",
            message: acknowledgement,
        });
    }
    finally {
        capture.stop();
    }
    assert.deepEqual(capture.output(), []);
});
test("console communication logging reports one wait state per failure", () => {
    const logger = new ConsoleAgentCommunicationLogger();
    const capture = new ConsoleLogCapture();
    const hello = AgentCommunicationMessageFactory.hello(AGENT_ROLE.LLM);
    capture.start();
    try {
        logger.log({
            event: "message-sent",
            peerId: undefined,
            message: hello,
            status: AGENT_COMMUNICATION_SEND_STATUS.PEER_UNAVAILABLE,
        });
        logger.log({
            event: "message-sent",
            peerId: undefined,
            message: hello,
            status: AGENT_COMMUNICATION_SEND_STATUS.PEER_UNAVAILABLE,
        });
    }
    finally {
        capture.stop();
    }
    assert.deepEqual(capture.output(), [
        "\n◆ PEER CHANNEL WAITING  ·  status PEER UNAVAILABLE",
    ]);
});
test("console communication logging reports state and mission traffic", () => {
    const logger = new ConsoleAgentCommunicationLogger();
    const capture = new ConsoleLogCapture();
    const assignment = AgentCommunicationMessageFactory.rendezvousAssignment("rendezvous-1", 500, { x: 1, y: 2 }, { x: 2, y: 2 });
    capture.start();
    try {
        logger.log({
            event: "peer-discovered",
            peerId: "peer-id",
            peerName: "bdi-agent",
        });
        logger.log({
            event: "peer-ready",
            peerId: "peer-id",
            peerRole: AGENT_ROLE.BDI,
        });
        logger.log({
            event: "message-sent",
            peerId: "peer-id",
            message: assignment,
            status: AGENT_COMMUNICATION_SEND_STATUS.SENT,
        });
    }
    finally {
        capture.stop();
    }
    assert.deepEqual(capture.output(), [
        "\n◆ PEER DISCOVERED  bdi-agent  ·  id peer-id",
        "\n◆ PEER CHANNEL READY  role BDI  ·  id peer-id",
        "\n◆ RENDEZVOUS PROPOSED  mission rendezvous-1"
            + "  ·  reward +500  ·  my cell (1, 2)"
            + "  ·  peer cell (2, 2)  ·  sent to peer-id",
    ]);
});
test("console communication logging explains the arrival exchange", () => {
    const logger = new ConsoleAgentCommunicationLogger();
    const capture = new ConsoleLogCapture();
    const localArrival = AgentCommunicationMessageFactory.rendezvousArrived(AGENT_ROLE.LLM, "rendezvous-1", { x: 1, y: 2 });
    const localArrivalAcknowledgement = AgentCommunicationMessageFactory
        .rendezvousArrivalAcknowledgement(AGENT_ROLE.BDI, "rendezvous-1", localArrival.messageId);
    const peerArrival = AgentCommunicationMessageFactory.rendezvousArrived(AGENT_ROLE.BDI, "rendezvous-1", { x: 2, y: 2 });
    const peerArrivalAcknowledgement = AgentCommunicationMessageFactory
        .rendezvousArrivalAcknowledgement(AGENT_ROLE.LLM, "rendezvous-1", peerArrival.messageId);
    capture.start();
    try {
        logger.log({
            event: "message-sent",
            peerId: "peer-id",
            message: localArrival,
            status: AGENT_COMMUNICATION_SEND_STATUS.SENT,
        });
        logger.log({
            event: "message-received",
            peerId: "peer-id",
            message: localArrivalAcknowledgement,
        });
        logger.log({
            event: "message-received",
            peerId: "peer-id",
            message: peerArrival,
        });
        logger.log({
            event: "message-sent",
            peerId: "peer-id",
            message: peerArrivalAcknowledgement,
            status: AGENT_COMMUNICATION_SEND_STATUS.SENT,
        });
    }
    finally {
        capture.stop();
    }
    assert.deepEqual(capture.output(), [
        "\n◆ I ARRIVED  mission rendezvous-1"
            + "  ·  cell (1, 2)  ·  peer notification sent",
        "✓ MY ARRIVAL CONFIRMED  mission rendezvous-1"
            + "  ·  peer peer-id received my notification",
        "\n◆ PEER ARRIVED  mission rendezvous-1"
            + "  ·  cell (2, 2)  ·  peer peer-id",
        "✓ PEER ARRIVAL CONFIRMED  mission rendezvous-1"
            + "  ·  acknowledgement sent to peer-id",
    ]);
});
//# sourceMappingURL=_communication-logging-tests.js.map