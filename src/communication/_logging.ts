import { AGENT_COMMUNICATION_SEND_STATUS } from "./_base.js";
import { TerminalTheme } from "../presentation/index.js";
import {
    type AgentCommunicationMessage,
    type AGENT_ROLE,
    PEER_MESSAGE_TYPE,
} from "./_messages.js";

/** Observable peer-communication event. */
export type AgentCommunicationLog =
    | {
        readonly event: "peer-discovered" | "peer-disconnected";
        readonly peerId: string;
        readonly peerName: string;
    }
    | {
        readonly event: "message-sent";
        readonly peerId: string | undefined;
        readonly message: AgentCommunicationMessage;
        readonly status: AGENT_COMMUNICATION_SEND_STATUS;
    }
    | {
        readonly event: "message-received";
        readonly peerId: string;
        readonly message: AgentCommunicationMessage;
    }
    | {
        readonly event: "message-rejected";
        readonly senderId: string;
        readonly reason: "unexpected-peer" | "unexpected-role";
    }
    | {
        readonly event: "handler-failed";
        readonly peerId: string;
        readonly error: unknown;
    }
    | {
        readonly event: "send-failed";
        readonly peerId: string;
        readonly message: AgentCommunicationMessage;
        readonly error: unknown;
    }
    | {
        readonly event: "peer-ready";
        readonly peerId: string;
        readonly peerRole: AGENT_ROLE;
    };

/** Logging contract shared by communication transports and services. */
export abstract class BaseAgentCommunicationLogger {
    abstract log(event: AgentCommunicationLog): void;
}

/** Default logger for tests or deployments that do not expose protocol events. */
export class SilentAgentCommunicationLogger
    extends BaseAgentCommunicationLogger {
    log(_event: AgentCommunicationLog): void { }
}

/** Human-readable logger for peer connection and protocol diagnostics. */
export class ConsoleAgentCommunicationLogger
    extends BaseAgentCommunicationLogger {
    private readonly theme: TerminalTheme = new TerminalTheme();
    private lastHandshakeFailure:
        AGENT_COMMUNICATION_SEND_STATUS | undefined;

    log(event: AgentCommunicationLog): void {
        switch (event.event) {
            case "peer-discovered":
                this.lastHandshakeFailure = undefined;
                console.log(
                    `\n◆ PEER DISCOVERED`
                    + `  ${event.peerName}`
                    + `  ·  id ${event.peerId}`,
                );
                return;
            case "peer-disconnected":
                this.lastHandshakeFailure = undefined;
                console.log(
                    `\n◆ PEER DISCONNECTED`
                    + `  ${event.peerName}`
                    + `  ·  id ${event.peerId}`,
                );
                return;
            case "message-sent":
                if (ConsoleAgentCommunicationLogger.isHandshakeMessage(
                    event.message,
                )) {
                    this.logHandshakeStatus(event.status);
                    return;
                }
                console.log(this.theme.violet(this.formatSentMessage(
                    event.message,
                    event.peerId,
                    event.status,
                )));
                return;
            case "message-received":
                if (ConsoleAgentCommunicationLogger.isHandshakeMessage(
                    event.message,
                )) {
                    return;
                }
                console.log(
                    this.theme.violet(this.formatReceivedMessage(
                        event.message,
                        event.peerId,
                    )),
                );
                return;
            case "message-rejected":
                console.warn(
                    `Rejected peer message from ${event.senderId}: ${event.reason}`,
                );
                return;
            case "handler-failed":
                console.error(
                    `Peer message handler failed for ${event.peerId}`,
                    event.error,
                );
                return;
            case "send-failed":
                console.error(
                    `Peer message ${event.message.type} failed for ${event.peerId}`,
                    event.error,
                );
                return;
            case "peer-ready":
                this.lastHandshakeFailure = undefined;
                console.log(
                    `\n◆ PEER CHANNEL READY`
                    + `  role ${event.peerRole.toUpperCase()}`
                    + `  ·  id ${event.peerId}`,
                );
        }
    }

    /** Reports a handshake failure once per state instead of once per retry. */
    private logHandshakeStatus(
        status: AGENT_COMMUNICATION_SEND_STATUS,
    ): void {
        if (status === AGENT_COMMUNICATION_SEND_STATUS.SENT) {
            this.lastHandshakeFailure = undefined;
            return;
        }
        if (status === this.lastHandshakeFailure) {
            return;
        }
        this.lastHandshakeFailure = status;
        console.log(
            `\n◆ PEER CHANNEL WAITING`
            + `  ·  status ${status.replace(/-/g, " ").toUpperCase()}`,
        );
    }

    /** Whether a wire message is internal handshake traffic. */
    private static isHandshakeMessage(
        message: AgentCommunicationMessage,
    ): boolean {
        return message.type === PEER_MESSAGE_TYPE.HELLO
            || message.type === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT;
    }

    /** Formats an outbound domain message as an agent action. */
    private formatSentMessage(
        message: AgentCommunicationMessage,
        peerId: string | undefined,
        status: AGENT_COMMUNICATION_SEND_STATUS,
    ): string {
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
            case PEER_MESSAGE_TYPE.HELLO:
            case PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT:
                return "";
        }
    }

    /** Formats an inbound domain message as a peer state change. */
    private formatReceivedMessage(
        message: AgentCommunicationMessage,
        peerId: string,
    ): string {
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
            case PEER_MESSAGE_TYPE.HELLO:
            case PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT:
                return "";
        }
    }
}
