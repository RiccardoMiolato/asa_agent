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
export { AGENT_COMMUNICATION_PEER_STATUS, AGENT_COMMUNICATION_SEND_STATUS, BaseAgentCommunicationChannel, } from "./_base.js";
export { DeliverooAgentCommunicationChannel, } from "./_deliveroo.js";
export { PEER_CONNECTION_STATE, PeerHandshakeService, } from "./_handshake.js";
export { BaseAgentCommunicationLogger, ConsoleAgentCommunicationLogger, SilentAgentCommunicationLogger, } from "./_logging.js";
export { AGENT_COMMUNICATION_PROTOCOL, AGENT_COMMUNICATION_PROTOCOL_VERSION, AGENT_ROLE, PEER_MESSAGE_TYPE, AgentCommunicationMessageFactory, AgentCommunicationMessageParser, } from "./_messages.js";
//# sourceMappingURL=index.js.map