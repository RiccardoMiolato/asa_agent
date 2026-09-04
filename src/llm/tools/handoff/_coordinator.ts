import type { PlanningContext } from "../../../bdi/planning.js";
import {
    AGENT_ROLE,
    AgentCommunicationMessageFactory,
    BaseAgentCommunicationChannel,
    PEER_MESSAGE_TYPE,
    type AgentCommunicationMessage,
    type AgentCommunicationMessageHandler,
    type AgentCommunicationPeer,
    type ParcelHandoffAssignmentMessage,
    type ParcelHandoffAvailableMessage,
    type ParcelHandoffReadyMessage,
    type ParcelHandoffRequestMessage,
    type ParcelHandoffStatusMessage,
} from "../../../communication/index.js";
import { Position } from "../../../utils/position.js";
import {
    BalancedSurvivableParcelHandoffCandidateSelector,
    type BaseParcelHandoffCandidateSelector,
    type ParcelHandoffCandidate,
} from "./_selector.js";

/** Local phases of the two-agent parcel transfer protocol. */
export enum PARCEL_HANDOFF_STATE {
    IDLE = "idle",
    WAITING_FOR_STATUS = "waiting-for-status",
    WAITING_FOR_ASSIGNMENT = "waiting-for-assignment",
    PICKING = "picking",
    MOVING_TO_STAGING = "moving-to-staging",
    WAITING_FOR_READY = "waiting-for-ready",
    READY = "ready",
    RELEASING = "releasing",
    WAITING_FOR_COLLECTION = "waiting-for-collection",
    COLLECTING = "collecting",
    DELIVERING = "delivering",
    COMPLETED = "completed",
}

/** Executable coordination segment requested from the autonomous agent. */
export type ParcelHandoffInstruction =
    | {
        readonly type: "wait";
        readonly handoffId: string;
        readonly parcelId: string | undefined;
    }
    | {
        readonly type: "pick-up";
        readonly handoffId: string;
        readonly parcelId: string;
        readonly target: Position;
        readonly blockedCell: Position;
    }
    | {
        readonly type: "stage";
        readonly handoffId: string;
        readonly parcelId: string;
        readonly target: Position;
        readonly blockedCell: Position;
    }
    | {
        readonly type: "release";
        readonly handoffId: string;
        readonly parcelId: string;
        readonly handoffCell: Position;
        readonly target: Position;
    }
    | {
        readonly type: "collect";
        readonly handoffId: string;
        readonly parcelId: string;
        readonly target: Position;
    }
    | {
        readonly type: "deliver";
        readonly handoffId: string;
        readonly parcelId: string;
        readonly target: Position;
    };

/** Read-only handoff state for logs and tests. */
export interface ParcelHandoffSnapshot {
    readonly handoffId: string;
    readonly parcelId: string | undefined;
    readonly state: PARCEL_HANDOFF_STATE;
    readonly candidate: ParcelHandoffCandidate | undefined;
}

interface ParcelHandoffRecord {
    readonly handoffId: string;
    readonly reward: number;
    state: PARCEL_HANDOFF_STATE;
    peerPosition: Position | undefined;
    peerId: string | undefined;
    candidate: ParcelHandoffCandidate | undefined;
    requestMessage: ParcelHandoffRequestMessage | undefined;
    statusMessage: ParcelHandoffStatusMessage | undefined;
    assignmentMessage: ParcelHandoffAssignmentMessage | undefined;
    readyMessage: ParcelHandoffReadyMessage | undefined;
    readyAcknowledged: boolean;
    availableMessage: ParcelHandoffAvailableMessage | undefined;
    peerCollected: boolean;
}

export type ParcelHandoffStateChangeHandler = () => void;

/** Contract between peer coordination and local planning/execution. */
export abstract class BaseParcelHandoffCoordinator {
    abstract start(): void;
    abstract stop(): void;
    abstract activate(handoffId: string, reward: number): void;
    abstract observePosition(position: Position): void;
    abstract refresh(context: PlanningContext): void;
    abstract instruction(
        context: PlanningContext,
    ): ParcelHandoffInstruction | undefined;
    abstract completeInstruction(
        instruction: ParcelHandoffInstruction,
        context: PlanningContext,
    ): void;
    abstract reservedParcelIds(): ReadonlySet<string>;
    abstract consumeCompletedHandoffIds(): readonly string[];
    abstract snapshot(): ParcelHandoffSnapshot | undefined;
    abstract subscribeStateChanges(
        handler: ParcelHandoffStateChangeHandler,
    ): void;
}

/** Reliable leader-assigned parcel handoff over the shared peer channel. */
export class PeerParcelHandoffCoordinator
    extends BaseParcelHandoffCoordinator {
    private readonly stateChangeHandlers =
        new Set<ParcelHandoffStateChangeHandler>();
    private readonly completedHandoffIds: string[] = [];
    private readonly messageHandler: AgentCommunicationMessageHandler;
    private record: ParcelHandoffRecord | undefined;
    private latestPosition: Position | undefined;
    private retryTimer: NodeJS.Timeout | undefined;
    private started: boolean = false;

    constructor(
        private readonly channel: BaseAgentCommunicationChannel,
        private readonly localRole: AGENT_ROLE,
        private readonly selector: BaseParcelHandoffCandidateSelector =
            new BalancedSurvivableParcelHandoffCandidateSelector(),
        private readonly retryMilliseconds: number = 1_000,
    ) {
        super();
        if (!Number.isFinite(retryMilliseconds) || retryMilliseconds <= 0) {
            throw new RangeError("Handoff retry duration must be positive");
        }
        this.messageHandler = (
            peer: AgentCommunicationPeer,
            message: AgentCommunicationMessage,
        ): void => this.handleMessage(peer, message);
    }

    start(): void {
        if (this.started) {
            throw new Error("The parcel handoff coordinator is already started");
        }
        this.started = true;
        this.channel.subscribe(this.messageHandler);
        this.retryTimer = setInterval(
            (): void => this.retryPendingMessage(),
            this.retryMilliseconds,
        );
    }

    stop(): void {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.channel.unsubscribe(this.messageHandler);
        this.started = false;
    }

    activate(handoffId: string, reward: number): void {
        if (this.localRole !== AGENT_ROLE.LLM) {
            throw new Error("Only the LLM agent can activate a parcel handoff");
        }
        if (this.record && this.record.state !== PARCEL_HANDOFF_STATE.COMPLETED) {
            throw new Error("Only one parcel handoff can be active at a time");
        }
        const requestMessage = AgentCommunicationMessageFactory
            .parcelHandoffRequest(handoffId, reward);
        this.record = this.makeRecord(
            handoffId,
            reward,
            PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS,
        );
        this.record.requestMessage = requestMessage;
        void this.channel.send(requestMessage);
        this.publishStateChange();
    }

    observePosition(position: Position): void {
        if (!position.isGridAligned()) {
            return;
        }
        this.latestPosition = new Position(position.x, position.y);
    }

    refresh(context: PlanningContext): void {
        const record = this.record;
        if (!record) {
            return;
        }
        if (
            this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            && record.peerPosition
        ) {
            const candidate = this.selector.select({
                planning: context,
                bdiAgentPosition: record.peerPosition,
            });
            if (candidate) {
                this.assignCandidate(record, candidate);
            }
            return;
        }
        if (!record.candidate) {
            return;
        }

        if (
            record.state === PARCEL_HANDOFF_STATE.PICKING
            && context.parcels.get(record.candidate.parcelId)?.carriedBy
                === context.agentId
        ) {
            this.setState(record, PARCEL_HANDOFF_STATE.WAITING_FOR_READY);
        }
        if (
            this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.PICKING
        ) {
            const assignedParcel = context.parcels.get(
                record.candidate.parcelId,
            );
            if (
                assignedParcel === undefined
                || assignedParcel.carriedBy !== undefined
            ) {
                this.restartSelection(record);
                return;
            }
        }
        if (
            record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_READY
            && record.readyMessage
            && this.receiverIsVerified(context, record)
        ) {
            record.readyAcknowledged = true;
            void this.channel.send(
                AgentCommunicationMessageFactory
                    .parcelHandoffReadyAcknowledgement(
                        record.handoffId,
                        record.candidate.parcelId,
                        record.readyMessage.messageId,
                    ),
            );
            this.setState(record, PARCEL_HANDOFF_STATE.RELEASING);
        }
        if (
            this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.MOVING_TO_STAGING
            && context.agentPosition.isEqual(record.candidate.stagingCell)
        ) {
            this.becomeReady(record);
        }
        if (
            this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.COLLECTING
            && context.parcels.get(record.candidate.parcelId)?.carriedBy
                === context.agentId
        ) {
            this.confirmCollection(record);
        }
    }

    instruction(
        context: PlanningContext,
    ): ParcelHandoffInstruction | undefined {
        const record = this.record;
        if (!record) {
            return undefined;
        }
        const candidate = record.candidate;
        switch (record.state) {
            case PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT:
            case PARCEL_HANDOFF_STATE.WAITING_FOR_READY:
            case PARCEL_HANDOFF_STATE.READY:
                return {
                    type: "wait",
                    handoffId: record.handoffId,
                    parcelId: candidate?.parcelId,
                };
            case PARCEL_HANDOFF_STATE.PICKING:
                return candidate ? {
                    type: "pick-up",
                    handoffId: record.handoffId,
                    parcelId: candidate.parcelId,
                    target: candidate.handoffCell,
                    blockedCell: candidate.stagingCell,
                } : undefined;
            case PARCEL_HANDOFF_STATE.MOVING_TO_STAGING:
                return candidate ? {
                    type: "stage",
                    handoffId: record.handoffId,
                    parcelId: candidate.parcelId,
                    target: candidate.stagingCell,
                    blockedCell: candidate.handoffCell,
                } : undefined;
            case PARCEL_HANDOFF_STATE.RELEASING:
                return candidate ? {
                    type: "release",
                    handoffId: record.handoffId,
                    parcelId: candidate.parcelId,
                    handoffCell: candidate.handoffCell,
                    target: candidate.escapeCell,
                } : undefined;
            case PARCEL_HANDOFF_STATE.COLLECTING:
                return candidate ? {
                    type: "collect",
                    handoffId: record.handoffId,
                    parcelId: candidate.parcelId,
                    target: candidate.handoffCell,
                } : undefined;
            case PARCEL_HANDOFF_STATE.DELIVERING:
                return candidate ? {
                    type: "deliver",
                    handoffId: record.handoffId,
                    parcelId: candidate.parcelId,
                    target: candidate.deliveryCell,
                } : undefined;
            case PARCEL_HANDOFF_STATE.IDLE:
            case PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS:
            case PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION:
            case PARCEL_HANDOFF_STATE.COMPLETED:
                return undefined;
        }
    }

    completeInstruction(
        instruction: ParcelHandoffInstruction,
        context: PlanningContext,
    ): void {
        const record = this.record;
        if (!record || record.handoffId !== instruction.handoffId) {
            return;
        }
        const candidate = record.candidate;
        if (!candidate || instruction.type === "wait") {
            return;
        }
        if (instruction.type === "pick-up") {
            if (context.parcels.get(candidate.parcelId)?.carriedBy
                === context.agentId) {
                this.setState(record, PARCEL_HANDOFF_STATE.WAITING_FOR_READY);
            }
            return;
        }
        if (instruction.type === "stage") {
            if (context.agentPosition.isEqual(candidate.stagingCell)) {
                this.becomeReady(record);
            }
            return;
        }
        if (instruction.type === "release") {
            if (!context.agentPosition.isEqual(candidate.escapeCell)) {
                return;
            }
            record.availableMessage = AgentCommunicationMessageFactory
                .parcelHandoffAvailable(
                    record.handoffId,
                    candidate.parcelId,
                    candidate.handoffCell,
                );
            void this.channel.send(record.availableMessage);
            this.setState(record, PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION);
            return;
        }
        if (instruction.type === "collect") {
            if (context.parcels.get(candidate.parcelId)?.carriedBy
                === context.agentId) {
                this.confirmCollection(record);
            }
            return;
        }
        if (
            instruction.type === "deliver"
            && context.parcels.get(candidate.parcelId)?.carriedBy
                !== context.agentId
        ) {
            void this.channel.send(
                AgentCommunicationMessageFactory.parcelHandoffDelivered(
                    record.handoffId,
                    candidate.parcelId,
                ),
            );
            this.complete(record);
        }
    }

    reservedParcelIds(): ReadonlySet<string> {
        const record = this.record;
        if (
            this.localRole !== AGENT_ROLE.LLM
            || !record?.candidate
            || record.peerCollected
            || record.state === PARCEL_HANDOFF_STATE.COMPLETED
        ) {
            return new Set<string>();
        }
        return new Set<string>([record.candidate.parcelId]);
    }

    consumeCompletedHandoffIds(): readonly string[] {
        return this.completedHandoffIds.splice(
            0,
            this.completedHandoffIds.length,
        );
    }

    snapshot(): ParcelHandoffSnapshot | undefined {
        return this.record ? {
            handoffId: this.record.handoffId,
            parcelId: this.record.candidate?.parcelId,
            state: this.record.state,
            candidate: this.record.candidate,
        } : undefined;
    }

    subscribeStateChanges(handler: ParcelHandoffStateChangeHandler): void {
        this.stateChangeHandlers.add(handler);
    }

    private handleMessage(
        peer: AgentCommunicationPeer,
        message: AgentCommunicationMessage,
    ): void {
        if (message.role === this.localRole) {
            return;
        }
        switch (message.type) {
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_REQUEST:
                this.handleRequest(peer, message);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_STATUS:
                this.handleStatus(peer, message);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_ASSIGNMENT:
                this.handleAssignment(peer, message);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY:
                this.handleReady(peer, message);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_READY_ACKNOWLEDGEMENT:
                this.handleReadyAcknowledgement(message.handoffId);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_AVAILABLE:
                this.handleAvailable(message);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_COLLECTED:
                this.handleCollected(message.handoffId, message.parcelId);
                return;
            case PEER_MESSAGE_TYPE.PARCEL_HANDOFF_DELIVERED:
                this.handleDelivered(message.handoffId, message.parcelId);
                return;
            default:
                return;
        }
    }

    private handleRequest(
        peer: AgentCommunicationPeer,
        message: ParcelHandoffRequestMessage,
    ): void {
        if (this.localRole !== AGENT_ROLE.BDI || !this.latestPosition) {
            return;
        }
        if (
            this.record?.handoffId === message.handoffId
            && this.record.requestMessage?.messageId === message.messageId
        ) {
            if (
                this.record.state
                    === PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT
                && this.record.statusMessage
            ) {
                void this.channel.send(this.record.statusMessage);
            }
            return;
        }
        this.record = this.makeRecord(
            message.handoffId,
            message.reward,
            PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT,
        );
        this.record.peerId = peer.id;
        this.record.requestMessage = message;
        this.record.statusMessage = AgentCommunicationMessageFactory
            .parcelHandoffStatus(
                message.handoffId,
                message.messageId,
                this.latestPosition,
            );
        void this.channel.send(
            this.record.statusMessage,
        );
        this.publishStateChange();
    }

    /** Restarts negotiation when the assigned parcel disappears before pickup. */
    private restartSelection(record: ParcelHandoffRecord): void {
        record.candidate = undefined;
        record.peerPosition = undefined;
        record.statusMessage = undefined;
        record.assignmentMessage = undefined;
        record.readyMessage = undefined;
        record.readyAcknowledged = false;
        record.availableMessage = undefined;
        record.peerCollected = false;
        record.requestMessage = AgentCommunicationMessageFactory
            .parcelHandoffRequest(record.handoffId, record.reward);
        void this.channel.send(record.requestMessage);
        this.setState(record, PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS);
    }

    private handleStatus(
        peer: AgentCommunicationPeer,
        message: ParcelHandoffStatusMessage,
    ): void {
        const record = this.record;
        if (
            this.localRole !== AGENT_ROLE.LLM
            || !record
            || record.state !== PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            || record.handoffId !== message.handoffId
            || record.requestMessage?.messageId
                !== message.acknowledgedMessageId
        ) {
            return;
        }
        record.peerId = peer.id;
        record.peerPosition = this.toPosition(message.position);
        this.publishStateChange();
    }

    private handleAssignment(
        peer: AgentCommunicationPeer,
        message: ParcelHandoffAssignmentMessage,
    ): void {
        if (this.localRole !== AGENT_ROLE.BDI) {
            return;
        }
        if (
            this.record?.handoffId === message.handoffId
            && this.record.candidate?.parcelId === message.parcelId
        ) {
            return;
        }
        const requestMessage = this.record?.handoffId === message.handoffId
            ? this.record.requestMessage
            : undefined;
        const record = this.makeRecord(
            message.handoffId,
            message.reward,
            PARCEL_HANDOFF_STATE.MOVING_TO_STAGING,
        );
        record.peerId = peer.id;
        record.requestMessage = requestMessage;
        record.candidate = this.candidateFromAssignment(message);
        record.assignmentMessage = message;
        this.record = record;
        this.publishStateChange();
    }

    private handleReady(
        peer: AgentCommunicationPeer,
        message: ParcelHandoffReadyMessage,
    ): void {
        const record = this.matchingRecord(message.handoffId, message.parcelId);
        if (this.localRole !== AGENT_ROLE.LLM || !record) {
            return;
        }
        if (
            record.state === PARCEL_HANDOFF_STATE.RELEASING
            || record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION
        ) {
            void this.channel.send(
                AgentCommunicationMessageFactory
                    .parcelHandoffReadyAcknowledgement(
                        record.handoffId,
                        message.parcelId,
                        message.messageId,
                    ),
            );
            return;
        }
        if (record.readyMessage?.messageId === message.messageId) {
            return;
        }
        record.peerId = peer.id;
        record.readyMessage = message;
        this.publishStateChange();
    }

    private handleReadyAcknowledgement(handoffId: string): void {
        const record = this.record;
        if (
            this.localRole === AGENT_ROLE.BDI
            && record?.handoffId === handoffId
            && record.state === PARCEL_HANDOFF_STATE.READY
        ) {
            record.readyAcknowledged = true;
        }
    }

    private handleAvailable(message: ParcelHandoffAvailableMessage): void {
        const record = this.matchingRecord(message.handoffId, message.parcelId);
        if (
            this.localRole !== AGENT_ROLE.BDI
            || !record
            || record.state !== PARCEL_HANDOFF_STATE.READY
        ) {
            return;
        }
        this.setState(record, PARCEL_HANDOFF_STATE.COLLECTING);
    }

    private handleCollected(handoffId: string, parcelId: string): void {
        const record = this.matchingRecord(handoffId, parcelId);
        if (this.localRole !== AGENT_ROLE.LLM || !record) {
            return;
        }
        record.peerCollected = true;
        this.publishStateChange();
    }

    private handleDelivered(handoffId: string, parcelId: string): void {
        const record = this.matchingRecord(handoffId, parcelId);
        if (this.localRole === AGENT_ROLE.LLM && record) {
            this.complete(record);
        }
    }

    private assignCandidate(
        record: ParcelHandoffRecord,
        candidate: ParcelHandoffCandidate,
    ): void {
        record.candidate = candidate;
        record.assignmentMessage = AgentCommunicationMessageFactory
            .parcelHandoffAssignment(
                record.handoffId,
                record.reward,
                candidate.parcelId,
                candidate.handoffCell,
                candidate.stagingCell,
                candidate.escapeCell,
                candidate.deliveryCell,
            );
        void this.channel.send(record.assignmentMessage);
        this.setState(record, PARCEL_HANDOFF_STATE.PICKING);
    }

    private becomeReady(record: ParcelHandoffRecord): void {
        const candidate = record.candidate;
        if (!candidate || !this.latestPosition) {
            return;
        }
        record.readyMessage = AgentCommunicationMessageFactory
            .parcelHandoffReady(
                record.handoffId,
                candidate.parcelId,
                this.latestPosition,
            );
        void this.channel.send(record.readyMessage);
        this.setState(record, PARCEL_HANDOFF_STATE.READY);
    }

    private confirmCollection(record: ParcelHandoffRecord): void {
        const candidate = record.candidate;
        if (!candidate) {
            return;
        }
        void this.channel.send(
            AgentCommunicationMessageFactory.parcelHandoffCollected(
                record.handoffId,
                candidate.parcelId,
            ),
        );
        this.setState(record, PARCEL_HANDOFF_STATE.DELIVERING);
    }

    private receiverIsVerified(
        context: PlanningContext,
        record: ParcelHandoffRecord,
    ): boolean {
        const candidate = record.candidate;
        const ready = record.readyMessage;
        if (
            !candidate
            || !ready
            || !this.toPosition(ready.position).isEqual(candidate.stagingCell)
            || candidate.handoffCell.distanceTo(candidate.stagingCell) !== 1
        ) {
            return false;
        }
        return record.peerId !== undefined
            && this.agentAt(context, record.peerId, candidate.stagingCell);
    }

    private agentAt(
        context: PlanningContext,
        agentId: string,
        position: Position,
    ): boolean {
        const agent = context.sensedAgents.get(agentId);
        return agent !== undefined
            && Math.round(agent.x) === position.x
            && Math.round(agent.y) === position.y;
    }

    private retryPendingMessage(): void {
        const record = this.record;
        if (!record) {
            return;
        }
        if (
            this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            && record.requestMessage
        ) {
            void this.channel.send(record.requestMessage);
        } else if (
            this.localRole === AGENT_ROLE.LLM
            && (record.state === PARCEL_HANDOFF_STATE.PICKING
                || record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_READY)
            && record.assignmentMessage
        ) {
            void this.channel.send(record.assignmentMessage);
        } else if (
            this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.READY
            && !record.readyAcknowledged
            && record.readyMessage
        ) {
            void this.channel.send(record.readyMessage);
        } else if (
            this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION
            && !record.peerCollected
            && record.availableMessage
        ) {
            void this.channel.send(record.availableMessage);
        }
    }

    private candidateFromAssignment(
        message: ParcelHandoffAssignmentMessage,
    ): ParcelHandoffCandidate {
        return {
            parcelId: message.parcelId,
            parcelReward: 0,
            handoffCell: this.toPosition(message.handoffCell),
            stagingCell: this.toPosition(message.stagingCell),
            escapeCell: this.toPosition(message.escapeCell),
            deliveryCell: this.toPosition(message.deliveryCell),
            llmMovementSteps: 0,
            bdiMovementSteps: 0,
            pathImbalanceMilliseconds: 0,
            estimatedCompletionMilliseconds: 0,
            estimatedRewardAtDelivery: 0,
        };
    }

    private matchingRecord(
        handoffId: string,
        parcelId: string,
    ): ParcelHandoffRecord | undefined {
        return this.record?.handoffId === handoffId
            && this.record.candidate?.parcelId === parcelId
            ? this.record
            : undefined;
    }

    private complete(record: ParcelHandoffRecord): void {
        if (record.state === PARCEL_HANDOFF_STATE.COMPLETED) {
            return;
        }
        record.state = PARCEL_HANDOFF_STATE.COMPLETED;
        this.completedHandoffIds.push(record.handoffId);
        this.publishStateChange();
    }

    private setState(
        record: ParcelHandoffRecord,
        state: PARCEL_HANDOFF_STATE,
    ): void {
        if (record.state === state) {
            return;
        }
        record.state = state;
        this.publishStateChange();
    }

    private makeRecord(
        handoffId: string,
        reward: number,
        state: PARCEL_HANDOFF_STATE,
    ): ParcelHandoffRecord {
        return {
            handoffId,
            reward,
            state,
            peerPosition: undefined,
            peerId: undefined,
            candidate: undefined,
            requestMessage: undefined,
            statusMessage: undefined,
            assignmentMessage: undefined,
            readyMessage: undefined,
            readyAcknowledged: false,
            availableMessage: undefined,
            peerCollected: false,
        };
    }

    private toPosition(position: { readonly x: number; readonly y: number }): Position {
        return new Position(position.x, position.y);
    }

    private publishStateChange(): void {
        for (const handler of this.stateChangeHandlers) {
            handler();
        }
    }
}
