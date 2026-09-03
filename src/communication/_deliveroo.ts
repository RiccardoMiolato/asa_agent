import {
    AGENT_COMMUNICATION_PEER_STATUS,
    AGENT_COMMUNICATION_SEND_STATUS,
    BaseAgentCommunicationChannel,
    type AgentCommunicationPeer,
    type UnhandledAgentMessageHandler,
} from "./_base.js";
import {
    BaseAgentCommunicationLogger,
    SilentAgentCommunicationLogger,
} from "./_logging.js";
import {
    type AgentCommunicationMessage,
    AgentCommunicationMessageParser,
} from "./_messages.js";

/** Agent metadata broadcast by the Deliveroo controller event. */
export interface DeliverooConnectedAgent {
    readonly id: string;
    readonly name: string;
    readonly teamId: string;
    readonly teamName: string;
    readonly score: number;
}

/** Structural boundary around the third-party Socket.io client. */
export interface DeliverooCommunicationSocket {
    onAgentConnected(
        callback: (
            status: "connected" | "disconnected",
            agent: DeliverooConnectedAgent,
        ) => void,
    ): void;
    onMsg(
        callback: (
            senderId: string,
            senderName: string,
            message: unknown,
            reply?: (message: unknown) => void,
        ) => void,
    ): void;
    emitSay(
        recipientId: string,
        message: AgentCommunicationMessage,
    ): Promise<"successful" | "failed">;
}

/** Peer channel implemented by the Deliveroo server's Socket.io message bus. */
export class DeliverooAgentCommunicationChannel
    extends BaseAgentCommunicationChannel {
    private discoveredPeer: AgentCommunicationPeer | undefined;
    private started: boolean = false;

    constructor(
        private readonly socket: DeliverooCommunicationSocket,
        private readonly expectedPeerName: string,
        private readonly logger: BaseAgentCommunicationLogger =
            new SilentAgentCommunicationLogger(),
    ) {
        super();
        if (expectedPeerName.length === 0) {
            throw new Error("A peer name is required for agent communication");
        }
    }

    /** Registers routing before the underlying socket is connected. */
    start(unhandledHandler: UnhandledAgentMessageHandler): void {
        if (this.started) {
            throw new Error("The agent communication channel is already started");
        }
        this.started = true;

        this.socket.onAgentConnected(
            (
                status: "connected" | "disconnected",
                agent: DeliverooConnectedAgent,
            ): void => this.handlePeerStatus(status, agent),
        );
        this.socket.onMsg(
            (
                senderId: string,
                senderName: string,
                rawMessage: unknown,
            ): void => {
                const sender: AgentCommunicationPeer = {
                    id: senderId,
                    name: senderName,
                };
                const message = AgentCommunicationMessageParser.parse(
                    rawMessage,
                );
                if (!message) {
                    unhandledHandler(sender, rawMessage);
                    return;
                }
                if (!this.isExpectedPeer(sender)) {
                    this.logger.log({
                        event: "message-rejected",
                        senderId,
                        reason: "unexpected-peer",
                    });
                    return;
                }

                this.rememberPeer(sender);
                this.logger.log({
                    event: "message-received",
                    peerId: senderId,
                    message,
                });
                void this.publish(sender, message).catch(
                    (error: unknown): void => {
                        this.logger.log({
                            event: "handler-failed",
                            peerId: senderId,
                            error,
                        });
                    },
                );
            },
        );
    }

    /** Sends one message to the peer identity learned from the server. */
    async send(
        message: AgentCommunicationMessage,
    ): Promise<AGENT_COMMUNICATION_SEND_STATUS> {
        const peer = this.discoveredPeer;
        if (!peer) {
            const status = AGENT_COMMUNICATION_SEND_STATUS.PEER_UNAVAILABLE;
            this.logger.log({
                event: "message-sent",
                peerId: undefined,
                message,
                status,
            });
            return status;
        }

        let serverStatus: "successful" | "failed";
        try {
            serverStatus = await this.socket.emitSay(peer.id, message);
        } catch (error: unknown) {
            this.logger.log({
                event: "send-failed",
                peerId: peer.id,
                message,
                error,
            });
            return AGENT_COMMUNICATION_SEND_STATUS.FAILED;
        }
        const status = serverStatus === "successful"
            ? AGENT_COMMUNICATION_SEND_STATUS.SENT
            : AGENT_COMMUNICATION_SEND_STATUS.FAILED;
        this.logger.log({
            event: "message-sent",
            peerId: peer.id,
            message,
            status,
        });
        return status;
    }

    /** Returns the peer currently announced as connected by the server. */
    peer(): AgentCommunicationPeer | undefined {
        return this.discoveredPeer;
    }

    private handlePeerStatus(
        status: "connected" | "disconnected",
        agent: DeliverooConnectedAgent,
    ): void {
        if (agent.name !== this.expectedPeerName) {
            return;
        }
        if (status === "connected") {
            this.rememberPeer(agent);
            return;
        }
        if (this.discoveredPeer?.id !== agent.id) {
            return;
        }

        this.discoveredPeer = undefined;
        this.logger.log({
            event: "peer-disconnected",
            peerId: agent.id,
            peerName: agent.name,
        });
        this.publishPeerStatus(
            agent,
            AGENT_COMMUNICATION_PEER_STATUS.DISCONNECTED,
        );
    }

    private isExpectedPeer(peer: AgentCommunicationPeer): boolean {
        return peer.name === this.expectedPeerName
            && (
                this.discoveredPeer === undefined
                || this.discoveredPeer.id === peer.id
            );
    }

    private rememberPeer(peer: AgentCommunicationPeer): void {
        if (this.discoveredPeer?.id === peer.id) {
            return;
        }
        this.discoveredPeer = peer;
        this.logger.log({
            event: "peer-discovered",
            peerId: peer.id,
            peerName: peer.name,
        });
        this.publishPeerStatus(
            peer,
            AGENT_COMMUNICATION_PEER_STATUS.CONNECTED,
        );
    }
}
