import type { AgentCommunicationMessage } from "./_messages.js";

/** Result of asking the game server to forward one peer message. */
export enum AGENT_COMMUNICATION_SEND_STATUS {
    SENT = "sent",
    FAILED = "failed",
    PEER_UNAVAILABLE = "peer-unavailable",
}

/** Connection status reported by the server for the configured peer. */
export enum AGENT_COMMUNICATION_PEER_STATUS {
    CONNECTED = "connected",
    DISCONNECTED = "disconnected",
}

/** Authenticated sender metadata supplied by Deliveroo Socket.io. */
export interface AgentCommunicationPeer {
    readonly id: string;
    readonly name: string;
}

/** Consumer of validated internal peer messages. */
export type AgentCommunicationMessageHandler = (
    peer: AgentCommunicationPeer,
    message: AgentCommunicationMessage,
) => void | Promise<void>;

/** Consumer of configured-peer connection changes. */
export type AgentCommunicationPeerStatusHandler = (
    peer: AgentCommunicationPeer,
    status: AGENT_COMMUNICATION_PEER_STATUS,
) => void;

/** Consumer of payloads that do not belong to the internal peer protocol. */
export type UnhandledAgentMessageHandler = (
    sender: AgentCommunicationPeer,
    message: unknown,
) => void;

/** Transport-independent contract for typed agent-to-agent communication. */
export abstract class BaseAgentCommunicationChannel {
    private readonly handlers: Set<AgentCommunicationMessageHandler> =
        new Set<AgentCommunicationMessageHandler>();
    private readonly peerStatusHandlers:
        Set<AgentCommunicationPeerStatusHandler> =
            new Set<AgentCommunicationPeerStatusHandler>();

    /** Starts peer discovery and inbound message routing. */
    abstract start(unhandledHandler: UnhandledAgentMessageHandler): void;

    /** Sends one validated protocol message to the configured peer. */
    abstract send(
        message: AgentCommunicationMessage,
    ): Promise<AGENT_COMMUNICATION_SEND_STATUS>;

    /** Returns the currently discovered peer, if it is connected. */
    abstract peer(): AgentCommunicationPeer | undefined;

    /** Registers one domain service interested in peer messages. */
    subscribe(handler: AgentCommunicationMessageHandler): void {
        this.handlers.add(handler);
    }

    /** Removes a previously registered domain service. */
    unsubscribe(handler: AgentCommunicationMessageHandler): void {
        this.handlers.delete(handler);
    }

    /** Registers one service interested in peer connection changes. */
    subscribePeerStatus(handler: AgentCommunicationPeerStatusHandler): void {
        this.peerStatusHandlers.add(handler);
    }

    /** Removes a previously registered peer-status service. */
    unsubscribePeerStatus(handler: AgentCommunicationPeerStatusHandler): void {
        this.peerStatusHandlers.delete(handler);
    }

    /** Delivers a validated message to every registered domain service. */
    protected async publish(
        peer: AgentCommunicationPeer,
        message: AgentCommunicationMessage,
    ): Promise<void> {
        let firstError: unknown;
        for (const handler of this.handlers) {
            try {
                await handler(peer, message);
            } catch (error: unknown) {
                firstError ??= error;
            }
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    }

    /** Delivers a peer connection change to every registered service. */
    protected publishPeerStatus(
        peer: AgentCommunicationPeer,
        status: AGENT_COMMUNICATION_PEER_STATUS,
    ): void {
        for (const handler of this.peerStatusHandlers) {
            handler(peer, status);
        }
    }
}
