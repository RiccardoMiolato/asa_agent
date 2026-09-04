import { AGENT_COMMUNICATION_PEER_STATUS, AGENT_COMMUNICATION_SEND_STATUS, BaseAgentCommunicationChannel, } from "./_base.js";
import { SilentAgentCommunicationLogger, } from "./_logging.js";
import { AgentCommunicationMessageParser, } from "./_messages.js";
/** Peer channel implemented by the Deliveroo server's Socket.io message bus. */
export class DeliverooAgentCommunicationChannel extends BaseAgentCommunicationChannel {
    constructor(socket, expectedPeerName, logger = new SilentAgentCommunicationLogger()) {
        super();
        this.socket = socket;
        this.expectedPeerName = expectedPeerName;
        this.logger = logger;
        this.started = false;
        if (expectedPeerName.length === 0) {
            throw new Error("A peer name is required for agent communication");
        }
    }
    /** Registers routing before the underlying socket is connected. */
    start(unhandledHandler) {
        if (this.started) {
            throw new Error("The agent communication channel is already started");
        }
        this.started = true;
        this.socket.onAgentConnected((status, agent) => this.handlePeerStatus(status, agent));
        this.socket.onMsg((senderId, senderName, rawMessage) => {
            const sender = {
                id: senderId,
                name: senderName,
            };
            const message = AgentCommunicationMessageParser.parse(rawMessage);
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
            void this.publish(sender, message).catch((error) => {
                this.logger.log({
                    event: "handler-failed",
                    peerId: senderId,
                    error,
                });
            });
        });
    }
    /** Sends one message to the peer identity learned from the server. */
    async send(message) {
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
        let serverStatus;
        try {
            serverStatus = await this.socket.emitSay(peer.id, message);
        }
        catch (error) {
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
    peer() {
        return this.discoveredPeer;
    }
    handlePeerStatus(status, agent) {
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
        this.publishPeerStatus(agent, AGENT_COMMUNICATION_PEER_STATUS.DISCONNECTED);
    }
    isExpectedPeer(peer) {
        return peer.name === this.expectedPeerName
            && (this.discoveredPeer === undefined
                || this.discoveredPeer.id === peer.id);
    }
    rememberPeer(peer) {
        if (this.discoveredPeer?.id === peer.id) {
            return;
        }
        this.discoveredPeer = peer;
        this.logger.log({
            event: "peer-discovered",
            peerId: peer.id,
            peerName: peer.name,
        });
        this.publishPeerStatus(peer, AGENT_COMMUNICATION_PEER_STATUS.CONNECTED);
    }
}
//# sourceMappingURL=_deliveroo.js.map