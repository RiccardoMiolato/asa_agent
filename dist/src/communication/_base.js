/** Result of asking the game server to forward one peer message. */
export var AGENT_COMMUNICATION_SEND_STATUS;
(function (AGENT_COMMUNICATION_SEND_STATUS) {
    AGENT_COMMUNICATION_SEND_STATUS["SENT"] = "sent";
    AGENT_COMMUNICATION_SEND_STATUS["FAILED"] = "failed";
    AGENT_COMMUNICATION_SEND_STATUS["PEER_UNAVAILABLE"] = "peer-unavailable";
})(AGENT_COMMUNICATION_SEND_STATUS || (AGENT_COMMUNICATION_SEND_STATUS = {}));
/** Connection status reported by the server for the configured peer. */
export var AGENT_COMMUNICATION_PEER_STATUS;
(function (AGENT_COMMUNICATION_PEER_STATUS) {
    AGENT_COMMUNICATION_PEER_STATUS["CONNECTED"] = "connected";
    AGENT_COMMUNICATION_PEER_STATUS["DISCONNECTED"] = "disconnected";
})(AGENT_COMMUNICATION_PEER_STATUS || (AGENT_COMMUNICATION_PEER_STATUS = {}));
/** Transport-independent contract for typed agent-to-agent communication. */
export class BaseAgentCommunicationChannel {
    constructor() {
        this.handlers = new Set();
        this.peerStatusHandlers = new Set();
    }
    /** Registers one domain service interested in peer messages. */
    subscribe(handler) {
        this.handlers.add(handler);
    }
    /** Removes a previously registered domain service. */
    unsubscribe(handler) {
        this.handlers.delete(handler);
    }
    /** Registers one service interested in peer connection changes. */
    subscribePeerStatus(handler) {
        this.peerStatusHandlers.add(handler);
    }
    /** Removes a previously registered peer-status service. */
    unsubscribePeerStatus(handler) {
        this.peerStatusHandlers.delete(handler);
    }
    /** Delivers a validated message to every registered domain service. */
    async publish(peer, message) {
        let firstError;
        for (const handler of this.handlers) {
            try {
                await handler(peer, message);
            }
            catch (error) {
                firstError ?? (firstError = error);
            }
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    }
    /** Delivers a peer connection change to every registered service. */
    publishPeerStatus(peer, status) {
        for (const handler of this.peerStatusHandlers) {
            handler(peer, status);
        }
    }
}
//# sourceMappingURL=_base.js.map