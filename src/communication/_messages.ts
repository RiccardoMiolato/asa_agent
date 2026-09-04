import { randomUUID } from "node:crypto";

/** Stable marker distinguishing internal messages from chat missions. */
export const AGENT_COMMUNICATION_PROTOCOL = "asa-agent-peer";

/** Wire-format version understood by this implementation. */
export const AGENT_COMMUNICATION_PROTOCOL_VERSION = 1;

/** Runtime responsibility of one autonomous peer. */
export enum AGENT_ROLE {
    BDI = "bdi",
    LLM = "llm",
}

/** Message kinds currently supported by the peer protocol. */
export enum PEER_MESSAGE_TYPE {
    HELLO = "peer-hello",
    HELLO_ACKNOWLEDGEMENT = "peer-hello-acknowledgement",
    RENDEZVOUS_ASSIGNMENT = "rendezvous-assignment",
    RENDEZVOUS_ACKNOWLEDGEMENT = "rendezvous-acknowledgement",
    GRID_FORMATION_PROPOSAL = "grid-formation-proposal",
    GRID_FORMATION_ACCEPTANCE = "grid-formation-acceptance",
    GRID_FORMATION_RELEASE = "grid-formation-release",
    GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT =
        "grid-formation-release-acknowledgement",
    RENDEZVOUS_ARRIVED = "rendezvous-arrived",
    RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT =
        "rendezvous-arrival-acknowledgement",
}

declare const AGENT_COMMUNICATION_MESSAGE_ID: unique symbol;

/** Semantically distinct identity used to correlate wire messages. */
export type AgentCommunicationMessageId = string & {
    readonly [AGENT_COMMUNICATION_MESSAGE_ID]: never;
};

interface BaseAgentCommunicationMessage {
    readonly protocol: typeof AGENT_COMMUNICATION_PROTOCOL;
    readonly protocolVersion: typeof AGENT_COMMUNICATION_PROTOCOL_VERSION;
    readonly messageId: AgentCommunicationMessageId;
    readonly sentAt: number;
}

/** Serializable grid coordinate used at the transport boundary. */
export interface AgentCommunicationPosition {
    readonly x: number;
    readonly y: number;
}

/** Serializable exact, parity, or wildcard position predicate. */
export interface AgentCommunicationPositionObjective {
    readonly x: number | "odd" | "even" | null;
    readonly y: number | "odd" | "even" | null;
}

/** Announces one peer and requests proof that the other peer is reachable. */
export interface PeerHelloMessage extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.HELLO;
    readonly role: AGENT_ROLE;
}

/** Confirms receipt of one particular peer announcement. */
export interface PeerHelloAcknowledgementMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT;
    readonly role: AGENT_ROLE;
    readonly acknowledgedMessageId: AgentCommunicationMessageId;
}

/** Assigns one safe cell to each participant in a joint rendezvous. */
export interface RendezvousAssignmentMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT;
    readonly role: AGENT_ROLE.LLM;
    readonly rendezvousId: string;
    readonly reward: number;
    readonly llmAgentTarget: AgentCommunicationPosition;
    readonly bdiAgentTarget: AgentCommunicationPosition;
}

/** Confirms that the BDI peer installed one rendezvous assignment. */
export interface RendezvousAcknowledgementMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT;
    readonly role: AGENT_ROLE.BDI;
    readonly rendezvousId: string;
    readonly acknowledgedMessageId: AgentCommunicationMessageId;
}

/** Proposes two predicates while reserving the LLM agent's resolved target. */
export interface GridFormationProposalMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL;
    readonly role: AGENT_ROLE.LLM;
    readonly rendezvousId: string;
    readonly reward: number;
    readonly llmAgentTarget: AgentCommunicationPosition;
    readonly llmAgentObjective: AgentCommunicationPositionObjective;
    readonly bdiAgentObjective: AgentCommunicationPositionObjective;
}

/** Accepts a formation proposal with the BDI agent's locally closest cell. */
export interface GridFormationAcceptanceMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE;
    readonly role: AGENT_ROLE.BDI;
    readonly rendezvousId: string;
    readonly acknowledgedMessageId: AgentCommunicationMessageId;
    readonly bdiAgentTarget: AgentCommunicationPosition;
}

/** Releases both agents after mission control sends the green-light message. */
export interface GridFormationReleaseMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE;
    readonly role: AGENT_ROLE.LLM;
    readonly rendezvousId: string;
}

/** Confirms that the BDI peer consumed one formation release. */
export interface GridFormationReleaseAcknowledgementMessage
    extends BaseAgentCommunicationMessage {
    readonly type:
        PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT;
    readonly role: AGENT_ROLE.BDI;
    readonly rendezvousId: string;
    readonly acknowledgedMessageId: AgentCommunicationMessageId;
}

/** Reports that one participant is physically at its assigned cell. */
export interface RendezvousArrivedMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED;
    readonly role: AGENT_ROLE;
    readonly rendezvousId: string;
    readonly position: AgentCommunicationPosition;
}

/** Confirms receipt of one participant's arrival announcement. */
export interface RendezvousArrivalAcknowledgementMessage
    extends BaseAgentCommunicationMessage {
    readonly type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT;
    readonly role: AGENT_ROLE;
    readonly rendezvousId: string;
    readonly acknowledgedMessageId: AgentCommunicationMessageId;
}

/** Every validated message accepted by the peer communication layer. */
export type AgentCommunicationMessage =
    | PeerHelloMessage
    | PeerHelloAcknowledgementMessage
    | RendezvousAssignmentMessage
    | RendezvousAcknowledgementMessage
    | GridFormationProposalMessage
    | GridFormationAcceptanceMessage
    | GridFormationReleaseMessage
    | GridFormationReleaseAcknowledgementMessage
    | RendezvousArrivedMessage
    | RendezvousArrivalAcknowledgementMessage;

/** Creates valid, correlated peer-protocol messages. */
export class AgentCommunicationMessageFactory {
    /** Creates the stable announcement retried during one connection attempt. */
    static hello(role: AGENT_ROLE): PeerHelloMessage {
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
    static helloAcknowledgement(
        role: AGENT_ROLE,
        acknowledgedMessageId: AgentCommunicationMessageId,
    ): PeerHelloAcknowledgementMessage {
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
    static rendezvousAssignment(
        rendezvousId: string,
        reward: number,
        llmAgentTarget: AgentCommunicationPosition,
        bdiAgentTarget: AgentCommunicationPosition,
    ): RendezvousAssignmentMessage {
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
    static rendezvousAcknowledgement(
        rendezvousId: string,
        acknowledgedMessageId: AgentCommunicationMessageId,
    ): RendezvousAcknowledgementMessage {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT,
            role: AGENT_ROLE.BDI,
            rendezvousId,
            acknowledgedMessageId,
        };
    }

    /** Proposes coordinate predicates while reserving the LLM target cell. */
    static gridFormationProposal(
        rendezvousId: string,
        reward: number,
        llmAgentTarget: AgentCommunicationPosition,
        llmAgentObjective: AgentCommunicationPositionObjective,
        bdiAgentObjective: AgentCommunicationPositionObjective,
    ): GridFormationProposalMessage {
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
    static gridFormationAcceptance(
        rendezvousId: string,
        acknowledgedMessageId: AgentCommunicationMessageId,
        bdiAgentTarget: AgentCommunicationPosition,
    ): GridFormationAcceptanceMessage {
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
    static gridFormationRelease(
        rendezvousId: string,
    ): GridFormationReleaseMessage {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE,
            role: AGENT_ROLE.LLM,
            rendezvousId,
        };
    }

    /** Confirms one exact green-light message. */
    static gridFormationReleaseAcknowledgement(
        rendezvousId: string,
        acknowledgedMessageId: AgentCommunicationMessageId,
    ): GridFormationReleaseAcknowledgementMessage {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type:
                PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT,
            role: AGENT_ROLE.BDI,
            rendezvousId,
            acknowledgedMessageId,
        };
    }

    /** Announces arrival at the sender's assigned rendezvous cell. */
    static rendezvousArrived(
        role: AGENT_ROLE,
        rendezvousId: string,
        position: AgentCommunicationPosition,
    ): RendezvousArrivedMessage {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED,
            role,
            rendezvousId,
            position,
        };
    }

    /** Confirms receipt of one exact peer-arrival announcement. */
    static rendezvousArrivalAcknowledgement(
        role: AGENT_ROLE,
        rendezvousId: string,
        acknowledgedMessageId: AgentCommunicationMessageId,
    ): RendezvousArrivalAcknowledgementMessage {
        return {
            ...AgentCommunicationMessageFactory.base(),
            type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT,
            role,
            rendezvousId,
            acknowledgedMessageId,
        };
    }

    private static base(): BaseAgentCommunicationMessage {
        return {
            protocol: AGENT_COMMUNICATION_PROTOCOL,
            protocolVersion: AGENT_COMMUNICATION_PROTOCOL_VERSION,
            messageId: AgentCommunicationMessageFactory.messageId(),
            sentAt: Date.now(),
        };
    }

    private static messageId(): AgentCommunicationMessageId {
        return randomUUID() as AgentCommunicationMessageId;
    }
}

/** Validates untrusted Socket.io payloads at the communication boundary. */
export class AgentCommunicationMessageParser {
    static parse(value: unknown): AgentCommunicationMessage | undefined {
        if (!AgentCommunicationMessageParser.isRecord(value)) {
            return undefined;
        }
        if (
            value["protocol"] !== AGENT_COMMUNICATION_PROTOCOL
            || value["protocolVersion"]
                !== AGENT_COMMUNICATION_PROTOCOL_VERSION
            || !AgentCommunicationMessageParser.isNonEmptyString(
                value["messageId"],
            )
            || !AgentCommunicationMessageParser.isFiniteTimestamp(
                value["sentAt"],
            )
            || !AgentCommunicationMessageParser.isAgentRole(value["role"])
        ) {
            return undefined;
        }

        const messageId = value["messageId"] as AgentCommunicationMessageId;
        const common: BaseAgentCommunicationMessage & {
            readonly role: AGENT_ROLE;
        } = {
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
        if (
            value["type"] === PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["acknowledgedMessageId"],
            )
        ) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.HELLO_ACKNOWLEDGEMENT,
                acknowledgedMessageId:
                    value["acknowledgedMessageId"] as AgentCommunicationMessageId,
            };
        }
        if (
            value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isPositiveNumber(
                value["reward"],
            )
            && AgentCommunicationMessageParser.isPosition(
                value["llmAgentTarget"],
            )
            && AgentCommunicationMessageParser.isPosition(
                value["bdiAgentTarget"],
            )
        ) {
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
        if (
            value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["acknowledgedMessageId"],
            )
        ) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId:
                    value["acknowledgedMessageId"] as AgentCommunicationMessageId,
            };
        }
        if (
            value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isPositiveNumber(
                value["reward"],
            )
            && AgentCommunicationMessageParser.isPosition(
                value["llmAgentTarget"],
            )
            && AgentCommunicationMessageParser.isPositionObjective(
                value["llmAgentObjective"],
            )
            && AgentCommunicationMessageParser.isPositionObjective(
                value["bdiAgentObjective"],
            )
        ) {
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
        if (
            value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["acknowledgedMessageId"],
            )
            && AgentCommunicationMessageParser.isPosition(
                value["bdiAgentTarget"],
            )
        ) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId:
                    value["acknowledgedMessageId"] as AgentCommunicationMessageId,
                bdiAgentTarget: value["bdiAgentTarget"],
            };
        }
        if (
            value["type"] === PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE
            && value["role"] === AGENT_ROLE.LLM
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
        ) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE,
                role: AGENT_ROLE.LLM,
                rendezvousId: value["rendezvousId"],
            };
        }
        if (
            value["type"]
                === PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT
            && value["role"] === AGENT_ROLE.BDI
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["acknowledgedMessageId"],
            )
        ) {
            return {
                ...common,
                type:
                    PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT,
                role: AGENT_ROLE.BDI,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId:
                    value["acknowledgedMessageId"] as AgentCommunicationMessageId,
            };
        }
        if (
            value["type"] === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isPosition(value["position"])
        ) {
            return {
                ...common,
                type: PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED,
                rendezvousId: value["rendezvousId"],
                position: value["position"],
            };
        }
        if (
            value["type"]
                === PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["rendezvousId"],
            )
            && AgentCommunicationMessageParser.isNonEmptyString(
                value["acknowledgedMessageId"],
            )
        ) {
            return {
                ...common,
                type:
                    PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT,
                rendezvousId: value["rendezvousId"],
                acknowledgedMessageId:
                    value["acknowledgedMessageId"] as
                    AgentCommunicationMessageId,
            };
        }
        return undefined;
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }

    private static isNonEmptyString(value: unknown): value is string {
        return typeof value === "string" && value.length > 0;
    }

    private static isFiniteTimestamp(value: unknown): value is number {
        return typeof value === "number"
            && Number.isFinite(value)
            && value >= 0;
    }

    private static isPositiveNumber(value: unknown): value is number {
        return typeof value === "number"
            && Number.isFinite(value)
            && value > 0;
    }

    private static isPosition(
        value: unknown,
    ): value is AgentCommunicationPosition {
        return AgentCommunicationMessageParser.isRecord(value)
            && Number.isInteger(value["x"])
            && Number.isInteger(value["y"]);
    }

    private static isPositionObjective(
        value: unknown,
    ): value is AgentCommunicationPositionObjective {
        return AgentCommunicationMessageParser.isRecord(value)
            && AgentCommunicationMessageParser.isCoordinateObjective(
                value["x"],
            )
            && AgentCommunicationMessageParser.isCoordinateObjective(
                value["y"],
            );
    }

    private static isCoordinateObjective(
        value: unknown,
    ): value is number | "odd" | "even" | null {
        return value === null
            || value === "odd"
            || value === "even"
            || typeof value === "number" && Number.isInteger(value);
    }

    private static isAgentRole(value: unknown): value is AGENT_ROLE {
        return value === AGENT_ROLE.BDI || value === AGENT_ROLE.LLM;
    }
}
