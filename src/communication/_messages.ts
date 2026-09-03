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

/** Every validated message accepted by the peer communication layer. */
export type AgentCommunicationMessage =
    | PeerHelloMessage
    | PeerHelloAcknowledgementMessage;

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

    private static isAgentRole(value: unknown): value is AGENT_ROLE {
        return value === AGENT_ROLE.BDI || value === AGENT_ROLE.LLM;
    }
}
