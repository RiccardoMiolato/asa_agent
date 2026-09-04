import { AGENT_COMMUNICATION_SEND_STATUS } from "./_base.js";
import { TerminalTheme } from "../presentation/index.js";
import { PEER_MESSAGE_TYPE, } from "./_messages.js";
/** Logging contract shared by communication transports and services. */
export class BaseAgentCommunicationLogger {
}
/** Default logger for tests or deployments that do not expose protocol events. */
export class SilentAgentCommunicationLogger extends BaseAgentCommunicationLogger {
    log(_event) { }
}
/** Human-readable logger for peer connection and protocol diagnostics. */
export class ConsoleAgentCommunicationLogger extends BaseAgentCommunicationLogger {
    constructor() {
        super(...arguments);
        this.theme = new TerminalTheme();
        this.receivedHandoffMessageIds = new Set();
        this.sentHandoffMessageStatuses = new Map();
    }
    log(event) {
        switch (event.event) {
            case "peer-discovered":
                this.lastHandshakeFailure = undefined;
                console.log(`\n◆ PEER DISCOVERED`
                    + `  ${event.peerName}`
                    + `  ·  id ${event.peerId}`);
                return;
            case "peer-disconnected":
                this.lastHandshakeFailure = undefined;
                console.log(`\n◆ PEER DISCONNECTED`
                    + `  ${event.peerName}`
                    + `  ·  id ${event.peerId}`);
                return;
            case "message-sent":
                if (ConsoleAgentCommunicationLogger.isHandshakeMessage(event.message)) {
                    this.logHandshakeStatus(event.status);
                    return;
                }
                if (this.isRepeatedHandoffSend(event.message, event.status)) {
                    return;
                }
                const sentMessage = this.formatSentMessage(event.message, event.peerId, event.status);
                if (sentMessage.length > 0) {
                    console.log(this.theme.violet(sentMessage));
                }
                return;
            case "message-received":
                if (ConsoleAgentCommunicationLogger.isHandshakeMessage(event.message) || this.isRepeatedHandoffReception(event.message)) {
                    return;
                }
                const receivedMessage = this.formatReceivedMessage(event.message, event.peerId);
                if (receivedMessage.length > 0) {
                    console.log(this.theme.violet(receivedMessage));
                }
                return;
            case "message-rejected":
                console.warn(`Rejected peer message from ${event.senderId}: ${event.reason}`);
                return;
            case "handler-failed":
                console.error(`Peer message handler failed for ${event.peerId}`, event.error);
                return;
            case "send-failed":
                console.error(`Peer message ${event.message.type} failed for ${event.peerId}`, event.error);
                return;
            case "peer-ready":
                this.lastHandshakeFailure = undefined;
                console.log(`\n◆ PEER CHANNEL READY`
                    + `  role ${event.peerRole.toUpperCase()}`
                    + `  ·  id ${event.peerId}`);
        }
    }
    /** Reports a handshake failure once per state instead of once per retry. */
    logHandshakeStatus(status) {
        if (status === AGENT_COMMUNICATION_SEND_STATUS.SENT) {
            this.lastHandshakeFailure = undefined;
            return;
        }
        if (status === this.lastHandshakeFailure) {
            return;
        }
        this.lastHandshakeFailure = status;
        console.log(`\n◆ PEER CHANNEL WAITING`
            + `  ·  status ${status.replace(/-/g, " ").toUpperCase()}`);
    }
    /** Whether a wire message is internal handshake traffic. */
    static isHandshakeMessage(message) {
        return message.type === PEER_MESSAGE_TYPE.HELLO
            || message.type === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT;
    }
    /** Suppresses retries while still reporting a changed delivery status. */
    isRepeatedHandoffSend(message, status) {
        if (!ConsoleAgentCommunicationLogger.isHandoffMessage(message)) {
            return false;
        }
        const previousStatus = this.sentHandoffMessageStatuses.get(message.messageId);
        this.sentHandoffMessageStatuses.set(message.messageId, status);
        this.trimRememberedMessages(this.sentHandoffMessageStatuses);
        return previousStatus === status;
    }
    /** Shows an inbound protocol transition once per wire-message identity. */
    isRepeatedHandoffReception(message) {
        if (!ConsoleAgentCommunicationLogger.isHandoffMessage(message)) {
            return false;
        }
        if (this.receivedHandoffMessageIds.has(message.messageId)) {
            return true;
        }
        this.receivedHandoffMessageIds.add(message.messageId);
        this.trimRememberedMessages(this.receivedHandoffMessageIds);
        return false;
    }
    static isHandoffMessage(message) {
        return message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY
            || message.type
                === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED
            || message.type === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED;
    }
    trimRememberedMessages(messages) {
        if (messages.size
            <= ConsoleAgentCommunicationLogger
                .REMEMBERED_HANDOFF_MESSAGE_LIMIT) {
            return;
        }
        const oldest = messages.keys().next();
        if (!oldest.done) {
            messages.delete(oldest.value);
        }
    }
    /** Formats an outbound domain message as an agent action. */
    formatSentMessage(message, peerId, status) {
        const peer = peerId ?? "unavailable";
        const delivery = status === AGENT_COMMUNICATION_SEND_STATUS.SENT
            ? "sent"
            : status.replace(/-/g, " ").toUpperCase();
        switch (message.type) {
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT:
                return `\n◆ RENDEZVOUS PROPOSED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  my cell (${message.llmAgentTarget.x}, ${message.llmAgentTarget.y})`
                    + `  ·  peer cell (${message.bdiAgentTarget.x}, ${message.bdiAgentTarget.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT:
                return `✓ RENDEZVOUS ACCEPTED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  confirmation ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL:
                return `\n◆ GRID FORMATION PROPOSED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  my cell (${message.llmAgentTarget.x}, ${message.llmAgentTarget.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE:
                return `✓ GRID FORMATION ACCEPTED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  peer cell (${message.bdiAgentTarget.x}, ${message.bdiAgentTarget.y})`
                    + `  ·  confirmation ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE:
                return `\n◆ GRID FORMATION RELEASED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT:
                return `✓ GRID FORMATION RELEASE CONFIRMED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  confirmation ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED:
                return `\n◆ I ARRIVED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  cell (${message.position.x}, ${message.position.y})`
                    + `  ·  peer notification ${delivery}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT:
                return `✓ PEER ARRIVAL CONFIRMED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  acknowledgement ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST:
                return `\n◆ HANDOFF NEGOTIATION STARTED`
                    + `  ·  mission ${message.handoffId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS:
                return `\n◆ HANDOFF POSITION SHARED`
                    + `  ·  mission ${message.handoffId}`
                    + `  ·  cell (${message.position.x}, ${message.position.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT:
                return `\n◆ HANDOFF ASSIGNED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  handoff (${message.handoffCell.x}, ${message.handoffCell.y})`
                    + `  ·  BDI staging (${message.stagingCell.x}, ${message.stagingCell.y})`
                    + `  ·  delivery (${message.deliveryCell.x}, ${message.deliveryCell.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY:
                return `\n◆ HANDOFF READY`
                    + `  parcel ${message.parcelId}`
                    + `  ·  waiting at (${message.position.x}, ${message.position.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT:
                return "";
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE:
                return `\n◆ HANDOFF PARCEL RELEASED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  available at (${message.handoffCell.x}, ${message.handoffCell.y})`
                    + `  ·  ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED:
                return `\n✓ HANDOFF PARCEL COLLECTED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  confirmation ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED:
                return `\n✓ HANDOFF COMPLETED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  joint bonus unlocked`
                    + `  ·  confirmation ${delivery} to ${peer}`;
            case PEER_MESSAGE_TYPE.HELLO:
            case PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT:
                return "";
        }
    }
    /** Formats an inbound domain message as a peer state change. */
    formatReceivedMessage(message, peerId) {
        switch (message.type) {
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT:
                return `\n◆ RENDEZVOUS RECEIVED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  my cell (${message.bdiAgentTarget.x}, ${message.bdiAgentTarget.y})`
                    + `  ·  peer cell (${message.llmAgentTarget.x}, ${message.llmAgentTarget.y})`
                    + `  ·  from ${peerId}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT:
                return `✓ PEER ACCEPTED RENDEZVOUS`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  peer ${peerId}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL:
                return `\n◆ GRID FORMATION RECEIVED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  from ${peerId}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE:
                return `✓ PEER ACCEPTED GRID FORMATION`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  peer cell (${message.bdiAgentTarget.x}, ${message.bdiAgentTarget.y})`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE:
                return `\n◆ GRID FORMATION RELEASE RECEIVED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  from ${peerId}`;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT:
                return `✓ PEER RELEASED FROM GRID FORMATION`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  peer ${peerId}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED:
                return `\n◆ PEER ARRIVED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  cell (${message.position.x}, ${message.position.y})`
                    + `  ·  peer ${peerId}`;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT:
                return `✓ MY ARRIVAL CONFIRMED`
                    + `  mission ${message.rendezvousId}`
                    + `  ·  peer ${peerId} received my notification`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST:
                return `\n◆ HANDOFF REQUEST RECEIVED`
                    + `  ·  mission ${message.handoffId}`
                    + `  ·  reward +${message.reward}`
                    + `  ·  from ${peerId}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS:
                return `\n◆ BDI AVAILABLE FOR HANDOFF`
                    + `  ·  mission ${message.handoffId}`
                    + `  ·  cell (${message.position.x}, ${message.position.y})`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT:
                return `\n◆ HANDOFF ASSIGNMENT RECEIVED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  stage at (${message.stagingCell.x}, ${message.stagingCell.y})`
                    + `  ·  collect at (${message.handoffCell.x}, ${message.handoffCell.y})`
                    + `  ·  deliver at (${message.deliveryCell.x}, ${message.deliveryCell.y})`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY:
                return `\n◆ BDI READY FOR HANDOFF`
                    + `  parcel ${message.parcelId}`
                    + `  ·  reported cell (${message.position.x}, ${message.position.y})`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT:
                return "";
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE:
                return `\n◆ HANDOFF PARCEL AVAILABLE`
                    + `  parcel ${message.parcelId}`
                    + `  ·  collect at (${message.handoffCell.x}, ${message.handoffCell.y})`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED:
                return `\n✓ BDI COLLECTED HANDOFF PARCEL`
                    + `  ${message.parcelId}`;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED:
                return `\n✓ HANDOFF COMPLETED`
                    + `  parcel ${message.parcelId}`
                    + `  ·  joint bonus unlocked`;
            case PEER_MESSAGE_TYPE.HELLO:
            case PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT:
                return "";
        }
    }
}
ConsoleAgentCommunicationLogger.REMEMBERED_HANDOFF_MESSAGE_LIMIT = 256;
//# sourceMappingURL=_logging.js.map