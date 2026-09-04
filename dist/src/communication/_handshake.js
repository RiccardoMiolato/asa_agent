import { AGENT_COMMUNICATION_PEER_STATUS, } from "./_base.js";
import { SilentAgentCommunicationLogger, } from "./_logging.js";
import { AgentCommunicationMessageFactory, PEER_MESSAGE_TYPE, } from "./_messages.js";
/** Observable readiness of the bidirectional peer channel. */
export var PEER_CONNECTION_STATE;
(function (PEER_CONNECTION_STATE) {
    PEER_CONNECTION_STATE["IDLE"] = "idle";
    PEER_CONNECTION_STATE["CONNECTING"] = "connecting";
    PEER_CONNECTION_STATE["READY"] = "ready";
    PEER_CONNECTION_STATE["STOPPED"] = "stopped";
})(PEER_CONNECTION_STATE || (PEER_CONNECTION_STATE = {}));
/** Establishes symmetric peer reachability through correlated hello messages. */
export class PeerHandshakeService {
    constructor(channel, localRole, retryMilliseconds = 1000, logger = new SilentAgentCommunicationLogger()) {
        this.channel = channel;
        this.localRole = localRole;
        this.retryMilliseconds = retryMilliseconds;
        this.logger = logger;
        this.connectionState = PEER_CONNECTION_STATE.IDLE;
        this.receivedPeerHello = false;
        this.receivedHelloAcknowledgement = false;
        if (!Number.isFinite(retryMilliseconds) || retryMilliseconds <= 0) {
            throw new RangeError("Peer handshake retry duration must be finite and positive");
        }
        this.helloMessage = AgentCommunicationMessageFactory.hello(localRole);
        this.messageHandler = (peer, message) => this.handleMessage(peer, message);
        this.peerStatusHandler = (peer, status) => this.handlePeerStatus(peer, status);
    }
    /** Begins sending the stable hello message until both directions are proven. */
    start() {
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
    stop() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.channel.unsubscribe(this.messageHandler);
        this.channel.unsubscribePeerStatus(this.peerStatusHandler);
        this.connectionState = PEER_CONNECTION_STATE.STOPPED;
    }
    /** Returns whether the peer has demonstrated bidirectional reachability. */
    state() {
        return this.connectionState;
    }
    async sendHello() {
        if (this.connectionState !== PEER_CONNECTION_STATE.CONNECTING) {
            return;
        }
        await this.channel.send(this.helloMessage);
    }
    async handleMessage(peer, message) {
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
            await this.channel.send(AgentCommunicationMessageFactory.helloAcknowledgement(this.localRole, message.messageId));
        }
        else if (message.type
            === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT
            && message.acknowledgedMessageId === this.helloMessage.messageId) {
            this.receivedHelloAcknowledgement = true;
        }
        if (this.receivedPeerHello
            && this.receivedHelloAcknowledgement
            && this.connectionState !== PEER_CONNECTION_STATE.READY) {
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
    handlePeerStatus(_peer, status) {
        if (this.connectionState === PEER_CONNECTION_STATE.STOPPED) {
            return;
        }
        if (status === AGENT_COMMUNICATION_PEER_STATUS.CONNECTED) {
            void this.sendHello();
            return;
        }
        this.receivedPeerHello = false;
        this.receivedHelloAcknowledgement = false;
        this.helloMessage = AgentCommunicationMessageFactory.hello(this.localRole);
        this.connectionState = PEER_CONNECTION_STATE.CONNECTING;
        this.startRetryTimer();
    }
    startRetryTimer() {
        if (this.retryTimer) {
            return;
        }
        this.retryTimer = setInterval(() => void this.sendHello(), this.retryMilliseconds);
    }
}
//# sourceMappingURL=_handshake.js.map