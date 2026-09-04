import { randomUUID } from "node:crypto";
/** Stable marker distinguishing internal messages from chat missions. */
export const AGENT_COMMUNICATION_PROTOCOL = "asa-agent-peer";
/** Wire-format version understood by this implementation. */
export const AGENT_COMMUNICATION_PROTOCOL_VERSION = 1;
/** Runtime responsibility of one autonomous peer. */
export var AGENT_ROLE;
(function (AGENT_ROLE) {
    AGENT_ROLE["BDI"] = "bdi";
    AGENT_ROLE["LLM"] = "llm";
})(AGENT_ROLE || (AGENT_ROLE = {}));
/** Message kinds currently supported by the peer protocol. */
export var PEER_MESSAGE_TYPE;
(function (PEER_MESSAGE_TYPE) {
    PEER_MESSAGE_TYPE["HELLO"] = "peer-hello";
    PEER_MESSAGE_TYPE["HELLO_ACKNOWLEDGEMENT"] = "peer-hello-acknowledgement";
    PEER_MESSAGE_TYPE["RENDEZVOUS_ASSIGNMENT"] = "rendezvous-assignment";
    PEER_MESSAGE_TYPE["RENDEZVOUS_ACKNOWLEDGEMENT"] = "rendezvous-acknowledgement";
    PEER_MESSAGE_TYPE["GRID_FORMATION_PROPOSAL"] = "grid-formation-proposal";
    PEER_MESSAGE_TYPE["GRID_FORMATION_ACCEPTANCE"] = "grid-formation-acceptance";
    PEER_MESSAGE_TYPE["GRID_FORMATION_RELEASE"] = "grid-formation-release";
    PEER_MESSAGE_TYPE["GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT"] = "grid-formation-release-acknowledgement";
    PEER_MESSAGE_TYPE["RENDEZVOUS_ARRIVED"] = "rendezvous-arrived";
    PEER_MESSAGE_TYPE["RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT"] = "rendezvous-arrival-acknowledgement";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_REQUEST"] = "parcel-handoff-request";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_STATUS"] = "parcel-handoff-status";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_ASSIGNMENT"] = "parcel-handoff-assignment";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_READY"] = "parcel-handoff-ready";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT"] = "parcel-handoff-ready-acknowledgement";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_AVAILABLE"] = "parcel-handoff-available";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_COLLECTED"] = "parcel-handoff-collected";
    PEER_MESSAGE_TYPE["PARCEL_HANDOFF_DELIVERED"] = "parcel-handoff-delivered";
})(PEER_MESSAGE_TYPE || (PEER_MESSAGE_TYPE = {}));
/** Creates valid, correlated peer-protocol messages. */
export class AgentCommunicationMessageFactory {
    /** Creates the stable announcement retried during one connection attempt. */
    static hello(role) {
        return {
            protocol: AGENT_COMMUNICATION_PROTOCOL,
            protocolVersion: AGENT_COMMUNICATION_PROTOCOL_VERSION,
            messageId: AgentCommunicationMessageFactory.messageId(),
            sentAt: Date.now(),
            type: PEER_MESSAGE_TYPE.HELLO,
            role,
        };
    }
    /** Confirms receipt of one exact peer announcement. */
    static helloAcknowledgement(role, acknowledgedMessageId) {
        return {
            protocol: AGENT_COMMUNICATION_PROTOCOL,
            protocolVersion: AGENT_COMMUNICATION_PROTOCOL_VERSION,
            messageId: AgentCommunicationMessageFactory.messageId(),
            sentAt: Date.now(),
            type: PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT,
            role,
            acknowledgedMessageId,
        };
    }
    /** Creates the stable assignment retried until the BDI peer confirms it. */
    static rendezvousAssignment(rendezvousId, reward, llmAgentTarget, bdiAgentTarget) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT,
            role: AGENT_ROLE.LLM,
            rendezvousId,
            reward,
            llmAgentTarget,
            bdiAgentTarget,
        };
    }
    /** Confirms installation of one exact assignment message. */
    static rendezvousAcknowledgement(rendezvousId, acknowledgedMessageId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT,
            role: AGENT_ROLE.BDI,
            rendezvousId,
            acknowledgedMessageId,
        };
    }
    /** Proposes coordinate predicates while reserving the LLM target cell. */
    static gridFormationProposal(rendezvousId, reward, llmAgentTarget, llmAgentObjective, bdiAgentObjective) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL,
            role: AGENT_ROLE.LLM,
            rendezvousId,
            reward,
            llmAgentTarget,
            llmAgentObjective,
            bdiAgentObjective,
        };
    }
    /** Accepts one exact proposal with a locally selected BDI target. */
    static gridFormationAcceptance(rendezvousId, acknowledgedMessageId, bdiAgentTarget) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE,
            role: AGENT_ROLE.BDI,
            rendezvousId,
            acknowledgedMessageId,
            bdiAgentTarget,
        };
    }
    /** Sends the green light for one completed grid formation. */
    static gridFormationRelease(rendezvousId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE,
            role: AGENT_ROLE.LLM,
            rendezvousId,
        };
    }
    /** Confirms one exact green-light message. */
    static gridFormationReleaseAcknowledgement(rendezvousId, acknowledgedMessageId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT,
            role: AGENT_ROLE.BDI,
            rendezvousId,
            acknowledgedMessageId,
        };
    }
    /** Announces arrival at the sender's assigned rendezvous cell. */
    static rendezvousArrived(role, rendezvousId, position) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED,
            role,
            rendezvousId,
            position,
        };
    }
    /** Confirms receipt of one exact peer-arrival announcement. */
    static rendezvousArrivalAcknowledgement(role, rendezvousId, acknowledgedMessageId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT,
            role,
            rendezvousId,
            acknowledgedMessageId,
        };
    }
    static parcelHandoffRequest(handoffId, reward) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST,
            role: AGENT_ROLE.LLM,
            handoffId,
            reward,
        };
    }
    static parcelHandoffStatus(handoffId, acknowledgedMessageId, position) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS,
            role: AGENT_ROLE.BDI,
            handoffId,
            acknowledgedMessageId,
            position,
        };
    }
    static parcelHandoffAssignment(handoffId, reward, parcelId, handoffCell, stagingCell, escapeCell, deliveryCell) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT,
            role: AGENT_ROLE.LLM,
            handoffId,
            reward,
            parcelId,
            handoffCell,
            stagingCell,
            escapeCell,
            deliveryCell,
        };
    }
    static parcelHandoffReady(handoffId, parcelId, position) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY,
            role: AGENT_ROLE.BDI,
            handoffId,
            parcelId,
            position,
        };
    }
    static parcelHandoffReadyAcknowledgement(handoffId, parcelId, acknowledgedMessageId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT,
            role: AGENT_ROLE.LLM,
            handoffId,
            parcelId,
            acknowledgedMessageId,
        };
    }
    static parcelHandoffAvailable(handoffId, parcelId, handoffCell) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE,
            role: AGENT_ROLE.LLM,
            handoffId,
            parcelId,
            handoffCell,
        };
    }
    static parcelHandoffCollected(handoffId, parcelId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED,
            role: AGENT_ROLE.BDI,
            handoffId,
            parcelId,
        };
    }
    static parcelHandoffDelivered(handoffId, parcelId) {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED,
            role: AGENT_ROLE.BDI,
            handoffId,
            parcelId,
        };
    }
    static base() {
        return {
            protocol: AGENT_COMMUNICATION_PROTOCOL,
            protocolVersion: AGENT_COMMUNICATION_PROTOCOL_VERSION,
            messageId: AgentCommunicationMessageFactory.messageId(),
            sentAt: Date.now(),
        };
    }
    static messageId() {
        return randomUUID();
    }
}
/** Validates untrusted Socket.io payloads at the communication boundary. */
export class AgentCommunicationMessageParser {
    static parse(value) {
        if (!AgentCommunicationMessageParser.isRecord(value)) {
            return undefined;
        }
        if (value["protocol"] !== AGENT_COMMUNICATION_PROTOCOL
            || value["protocolVersion"]
                !== AGENT_COMMUNICATION_PROTOCOL_VERSION
            || !AgentCommunicationMessageParser.isNonEmptyString(value["messageId"])
            || !AgentCommunicationMessageParser.isFiniteTimestamp(value["sentAt"])
            || !AgentCommunicationMessageParser.isAgentRole(value["role"])) {
            return undefined;
        }
        const messageId = value["messageId"];
        const common = {
            protocol: AGENT_COMMUNICATION_PROTOCOL,
            protocolVersion: AGENT_COMMUNICATION_PROTOCOL_VERSION,
            messageId,
            sentAt: value["sentAt"],
            role: value["role"],
        };
        if (value["type"] === PEER_MESSAGE_TYPE.HELLO) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.HELLO,
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT,
                acknowledgedMessageId: value["acknowledgedMessageId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isPositiveNumber(value["reward"])
            && AgentCommunicationMessageParser.isPosition(value["llmAgentTarget"])
            && AgentCommunicationMessageParser.isPosition(value["bdiAgentTarget"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT,
                role: AGENT_ROLE.LLM,
                rendezvousId: value["rendezvousId"],
                reward: value["reward"],
                llmAgentTarget: value["llmAgentTarget"],
                bdiAgentTarget: value["bdiAgentTarget"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isPositiveNumber(value["reward"])
            && AgentCommunicationMessageParser.isPosition(value["llmAgentTarget"])
            && AgentCommunicationMessageParser.isPositionObjective(value["llmAgentObjective"])
            && AgentCommunicationMessageParser.isPositionObjective(value["bdiAgentObjective"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL,
                role: AGENT_ROLE.LLM,
                rendezvousId: value["rendezvousId"],
                reward: value["reward"],
                llmAgentTarget: value["llmAgentTarget"],
                llmAgentObjective: value["llmAgentObjective"],
                bdiAgentObjective: value["bdiAgentObjective"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])
            && AgentCommunicationMessageParser.isPosition(value["bdiAgentTarget"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
                bdiAgentTarget: value["bdiAgentTarget"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE,
                role: AGENT_ROLE.LLM,
                rendezvousId: value["rendezvousId"],
            };
        }
        if (value["type"]
            === PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isPosition(value["position"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED,
                rendezvousId: value["rendezvousId"],
                position: value["position"],
            };
        }
        if (value["type"]
            === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT
            && AgentCommunicationMessageParser.isNonEmptyString(value["rendezvousId"])
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(value["handoffId"])
            && AgentCommunicationMessageParser.isPositiveNumber(value["reward"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST,
                role: AGENT_ROLE.LLM,
                handoffId: value["handoffId"],
                reward: value["reward"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.hasHandoffIdentity(value)
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])
            && AgentCommunicationMessageParser.isPosition(value["position"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS,
                role: AGENT_ROLE.BDI,
                handoffId: value["handoffId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
                position: value["position"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.hasHandoffIdentity(value)
            && AgentCommunicationMessageParser.isPositiveNumber(value["reward"])
            && AgentCommunicationMessageParser.isNonEmptyString(value["parcelId"])
            && AgentCommunicationMessageParser.isPosition(value["handoffCell"])
            && AgentCommunicationMessageParser.isPosition(value["stagingCell"])
            && AgentCommunicationMessageParser.isPosition(value["escapeCell"])
            && AgentCommunicationMessageParser.isPosition(value["deliveryCell"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT,
                role: AGENT_ROLE.LLM,
                handoffId: value["handoffId"],
                reward: value["reward"],
                parcelId: value["parcelId"],
                handoffCell: value["handoffCell"],
                stagingCell: value["stagingCell"],
                escapeCell: value["escapeCell"],
                deliveryCell: value["deliveryCell"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.hasHandoffParcelIdentity(value)
            && AgentCommunicationMessageParser.isPosition(value["position"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY,
                role: AGENT_ROLE.BDI,
                handoffId: value["handoffId"],
                parcelId: value["parcelId"],
                position: value["position"],
            };
        }
        if (value["type"]
            === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.hasHandoffParcelIdentity(value)
            && AgentCommunicationMessageParser.isNonEmptyString(value["acknowledgedMessageId"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT,
                role: AGENT_ROLE.LLM,
                handoffId: value["handoffId"],
                parcelId: value["parcelId"],
                acknowledgedMessageId: value["acknowledgedMessageId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.hasHandoffParcelIdentity(value)
            && AgentCommunicationMessageParser.isPosition(value["handoffCell"])) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE,
                role: AGENT_ROLE.LLM,
                handoffId: value["handoffId"],
                parcelId: value["parcelId"],
                handoffCell: value["handoffCell"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.hasHandoffParcelIdentity(value)) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED,
                role: AGENT_ROLE.BDI,
                handoffId: value["handoffId"],
                parcelId: value["parcelId"],
            };
        }
        if (value["type"] === PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.hasHandoffParcelIdentity(value)) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED,
                role: AGENT_ROLE.BDI,
                handoffId: value["handoffId"],
                parcelId: value["parcelId"],
            };
        }
        return undefined;
    }
    static hasHandoffIdentity(value) {
        return AgentCommunicationMessageParser.isNonEmptyString(value["handoffId"]);
    }
    static hasHandoffParcelIdentity(value) {
        return AgentCommunicationMessageParser.hasHandoffIdentity(value)
            && AgentCommunicationMessageParser.isNonEmptyString(value["parcelId"]);
    }
    static isRecord(value) {
        return typeof value === "object" && value !== null;
    }
    static isNonEmptyString(value) {
        return typeof value === "string" && value.length > 0;
    }
    static isFiniteTimestamp(value) {
        return typeof value === "number"
            && Number.isFinite(value)
            && value >= 0;
    }
    static isPositiveNumber(value) {
        return typeof value === "number"
            && Number.isFinite(value)
            && value > 0;
    }
    static isPosition(value) {
        return AgentCommunicationMessageParser.isRecord(value)
            && Number.isInteger(value["x"])
            && Number.isInteger(value["y"]);
    }
    static isPositionObjective(value) {
        return AgentCommunicationMessageParser.isRecord(value)
            && AgentCommunicationMessageParser.isCoordinateObjective(value["x"])
            && AgentCommunicationMessageParser.isCoordinateObjective(value["y"]);
    }
    static isCoordinateObjective(value) {
        return value === null
            || value === "odd"
            || value === "even"
            || typeof value === "number" && Number.isInteger(value);
    }
    static isAgentRole(value) {
        return value === AGENT_ROLE.BDI || value === AGENT_ROLE.LLM;
    }
}
//# sourceMappingURL=_messages.js.map