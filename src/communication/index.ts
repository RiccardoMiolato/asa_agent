/**
 * Peer communication — typed agent-to-agent messaging over Deliveroo Socket.io.
 *
 * Directory structure:
 * ├── _base.ts       # Transport-independent channel contract and delivery states
 * ├── _deliveroo.ts  # Deliveroo Socket.io channel and peer discovery
 * ├── _handshake.ts  # Symmetric peer-readiness handshake
 * ├── _logging.ts    # Communication-specific logging contracts
 * └── _messages.ts   # Versioned wire messages, factories, and validation
 */

export {
    AGENT_COMMUNICATION_PEER_STATUS,
    AGENT_COMMUNICATION_SEND_STATUS,
    BaseAgentCommunicationChannel,
    type AgentCommunicationMessageHandler,
    type AgentCommunicationPeer,
    type AgentCommunicationPeerStatusHandler,
    type UnhandledAgentMessageHandler,
} from "./_base.js";
export {
    DeliverooAgentCommunicationChannel,
    type DeliverooConnectedAgent,
    type DeliverooCommunicationSocket,
} from "./_deliveroo.js";
export {
    PEER_CONNECTION_STATE,
    PeerHandshakeService,
} from "./_handshake.js";
export {
    BaseAgentCommunicationLogger,
    ConsoleAgentCommunicationLogger,
    SilentAgentCommunicationLogger,
    type AgentCommunicationLog,
} from "./_logging.js";
export {
    AGENT_COMMUNICATION_PROTOCOL,
    AGENT_COMMUNICATION_PROTOCOL_VERSION,
    AGENT_ROLE,
    PEER_MESSAGE_TYPE,
    AgentCommunicationMessageFactory,
    AgentCommunicationMessageParser,
    type AgentCommunicationMessage,
    type AgentCommunicationMessageId,
    type AgentCommunicationPosition,
    type PeerHelloAcknowledgementMessage,
    type PeerHelloMessage,
    type RendezvousAcknowledgementMessage,
    type RendezvousArrivedMessage,
    type RendezvousAssignmentMessage,
} from "./_messages.js";
