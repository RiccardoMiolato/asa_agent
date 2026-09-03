import {
    AGENT_COMMUNICATION_PEER_STATUS,
    BaseAgentCommunicationChannel,
    type AgentCommunicationMessageHandler,
    type AgentCommunicationPeer,
    type AgentCommunicationPeerStatusHandler,
} from "./_base.js";
import {
    BaseAgentCommunicationLogger,
    SilentAgentCommunicationLogger,
} from "./_logging.js";
import {
    AGENT_ROLE,
    type AgentCommunicationMessage,
    AgentCommunicationMessageFactory,
    PEER_MESSAGE_TYPE,
    type PeerHelloMessage,
} from "./_messages.js";

/** Observable readiness of the bidirectional peer channel. */
export enum PEER_CONNECTION_STATE {
    IDLE = "idle",
    CONNECTING = "connecting",
    READY = "ready",
    STOPPED = "stopped",
}

/** Establishes symmetric peer reachability through correlated hello messages. */
export class PeerHandshakeService {
    private helloMessage: PeerHelloMessage;
    private readonly messageHandler: AgentCommunicationMessageHandler;
    private readonly peerStatusHandler: AgentCommunicationPeerStatusHandler;
    private retryTimer: NodeJS.Timeout | undefined;
    private connectionState: PEER_CONNECTION_STATE =
        PEER_CONNECTION_STATE.IDLE;
    private receivedPeerHello: boolean = false;
    private receivedHelloAcknowledgement: boolean = false;

    constructor(
        private readonly channel: BaseAgentCommunicationChannel,
        private readonly localRole: AGENT_ROLE,
        private readonly retryMilliseconds: number = 1_000,
        private readonly logger: BaseAgentCommunicationLogger =
            new SilentAgentCommunicationLogger(),
    ) {
        if (!Number.isFinite(retryMilliseconds) || retryMilliseconds <= 0) {
            throw new RangeError(
                "Peer handshake retry duration must be finite and positive",
            );
        }
        this.helloMessage = AgentCommunicationMessageFactory.hello(localRole);
        this.messageHandler = (
            peer: AgentCommunicationPeer,
            message: AgentCommunicationMessage,
        ): Promise<void> => this.handleMessage(peer, message);
        this.peerStatusHandler = (
            peer: AgentCommunicationPeer,
            status: AGENT_COMMUNICATION_PEER_STATUS,
        ): void => this.handlePeerStatus(peer, status);
    }

    /** Begins sending the stable hello message until both directions are proven. */
    start(): void {
        if (this.connectionState !== PEER_CONNECTION_STATE.IDLE) {
            throw new Error("The peer handshake service can only be started once");
        }
        this.connectionState = PEER_CONNECTION_STATE.CONNECTING;
        this.channel.subscribe(this.messageHandler);
        this.channel.subscribePeerStatus(this.peerStatusHandler);
        void this.sendHello();
        this.startRetryTimer();
    }

    /** Stops retries and detaches this service from the shared channel. */
    stop(): void {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.channel.unsubscribe(this.messageHandler);
        this.channel.unsubscribePeerStatus(this.peerStatusHandler);
        this.connectionState = PEER_CONNECTION_STATE.STOPPED;
    }

    /** Returns whether the peer has demonstrated bidirectional reachability. */
    state(): PEER_CONNECTION_STATE {
        return this.connectionState;
    }

    private async sendHello(): Promise<void> {
        if (this.connectionState !== PEER_CONNECTION_STATE.CONNECTING) {
            return;
        }
        await this.channel.send(this.helloMessage);
    }

    private async handleMessage(
        peer: AgentCommunicationPeer,
        message: AgentCommunicationMessage,
    ): Promise<void> {
        if (this.connectionState === PEER_CONNECTION_STATE.STOPPED) {
            return;
        }
        if (message.role === this.localRole) {
            this.logger.log({
                event: "message-rejected",
                senderId: peer.id,
                reason: "unexpected-role",
            });
            return;
        }
        if (message.type === PEER_MESSAGE_TYPE.HELLO) {
            this.receivedPeerHello = true;
            await this.channel.send(
                AgentCommunicationMessageFactory.helloAcknowledgement(
                    this.localRole,
                    message.messageId,
                ),
            );
        } else if (
            message.type
                === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT
            && message.acknowledgedMessageId === this.helloMessage.messageId
        ) {
            this.receivedHelloAcknowledgement = true;
        }

        if (
            this.receivedPeerHello
            && this.receivedHelloAcknowledgement
            && this.connectionState !== PEER_CONNECTION_STATE.READY
        ) {
            this.connectionState = PEER_CONNECTION_STATE.READY;
            if (this.retryTimer) {
                clearInterval(this.retryTimer);
                this.retryTimer = undefined;
            }
            this.logger.log({
                event: "peer-ready",
                peerId: peer.id,
                peerRole: message.role,
            });
        }
    }

    private handlePeerStatus(
        _peer: AgentCommunicationPeer,
        status: AGENT_COMMUNICATION_PEER_STATUS,
    ): void {
        if (this.connectionState === PEER_CONNECTION_STATE.STOPPED) {
            return;
        }
        if (status === AGENT_COMMUNICATION_PEER_STATUS.CONNECTED) {
            void this.sendHello();
            return;
        }

        this.receivedPeerHello = false;
        this.receivedHelloAcknowledgement = false;
        this.helloMessage = AgentCommunicationMessageFactory.hello(
            this.localRole,
        );
        this.connectionState = PEER_CONNECTION_STATE.CONNECTING;
        this.startRetryTimer();
    }

    private startRetryTimer(): void {
        if (this.retryTimer) {
            return;
        }
        this.retryTimer = setInterval(
            (): void => void this.sendHello(),
            this.retryMilliseconds,
        );
    }
}
