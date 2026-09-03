import type { AGENT_COMMUNICATION_SEND_STATUS } from "./_base.js";
import type { AgentCommunicationMessage, AGENT_ROLE } from "./_messages.js";

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
    log(event: AgentCommunicationLog): void {
        switch (event.event) {
            case "peer-discovered":
                console.log(
                    `Peer discovered: ${event.peerName} (${event.peerId})`,
                );
                return;
            case "peer-disconnected":
                console.log(
                    `Peer disconnected: ${event.peerName} (${event.peerId})`,
                );
                return;
            case "message-sent":
                console.log(
                    `Peer message ${event.message.type} -> ${event.peerId ?? "unavailable"}: ${event.status}`,
                );
                return;
            case "message-received":
                console.log(
                    `Peer message ${event.message.type} <- ${event.peerId}`,
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
                console.log(
                    `Peer channel ready with ${event.peerId} (${event.peerRole})`,
                );
        }
    }
}
