import { AGENT_ROLE, AgentCommunicationMessageFactory, PEER_MESSAGE_TYPE, } from "../../../communication/index.js";
import { Position } from "../../../utils/position.js";
import { BalancedSurvivableParcelHandoffCandidateSelector, } from "./_selector.js";
/** Local phases of the two-agent parcel transfer protocol. */
export var PARCEL_HANDOFF_STATE;
(function (PARCEL_HANDOFF_STATE) {
    PARCEL_HANDOFF_STATE["IDLE"] = "idle";
    PARCEL_HANDOFF_STATE["WAITING_FOR_STATUS"] = "waiting-for-status";
    PARCEL_HANDOFF_STATE["WAITING_FOR_ASSIGNMENT"] = "waiting-for-assignment";
    PARCEL_HANDOFF_STATE["PICKING"] = "picking";
    PARCEL_HANDOFF_STATE["MOVING_TO_STAGING"] = "moving-to-staging";
    PARCEL_HANDOFF_STATE["WAITING_FOR_READY"] = "waiting-for-ready";
    PARCEL_HANDOFF_STATE["READY"] = "ready";
    PARCEL_HANDOFF_STATE["RELEASING"] = "releasing";
    PARCEL_HANDOFF_STATE["WAITING_FOR_COLLECTION"] = "waiting-for-collection";
    PARCEL_HANDOFF_STATE["COLLECTING"] = "collecting";
    PARCEL_HANDOFF_STATE["DELIVERING"] = "delivering";
    PARCEL_HANDOFF_STATE["COMPLETED"] = "completed";
})(PARCEL_HANDOFF_STATE || (PARCEL_HANDOFF_STATE = {}));
/** Contract between peer coordination and local planning/execution. */
export class BaseParcelHandoffCoordinator {
}
/** Reliable leader-assigned parcel handoff over the shared peer channel. */
export class PeerParcelHandoffCoordinator extends BaseParcelHandoffCoordinator {
    constructor(channel, localRole, selector = new BalancedSurvivableParcelHandoffCandidateSelector(), retryMilliseconds = 1000) {
        super();
        this.channel = channel;
        this.localRole = localRole;
        this.selector = selector;
        this.retryMilliseconds = retryMilliseconds;
        this.stateChangeHandlers = new Set();
        this.completedHandoffIds = [];
        this.started = false;
        if (!Number.isFinite(retryMilliseconds) || retryMilliseconds <= 0) {
            throw new RangeError("Handoff retry duration must be positive");
        }
        this.messageHandler = (peer, message) => this.handleMessage(peer, message);
    }
    start() {
        if (this.started) {
            throw new Error("The parcel handoff coordinator is already started");
        }
        this.started = true;
        this.channel.subscribe(this.messageHandler);
        this.retryTimer = setInterval(() => this.retryPendingMessage(), this.retryMilliseconds);
    }
    stop() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.channel.unsubscribe(this.messageHandler);
        this.started = false;
    }
    activate(handoffId, reward) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            throw new Error("Only the LLM agent can activate a parcel handoff");
        }
        if (this.record && this.record.state !== PARCEL_HANDOFF_STATE.COMPLETED) {
            throw new Error("Only one parcel handoff can be active at a time");
        }
        const requestMessage = AgentCommunicationMessageFactory
            .parcelHandoffRequest(handoffId, reward);
        this.record = this.makeRecord(handoffId, reward, PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS);
        this.record.requestMessage = requestMessage;
        void this.channel.send(requestMessage);
        this.publishStateChange();
    }
    observePosition(position) {
        if (!position.isGridAligned()) {
            return;
        }
        this.latestPosition = new Position(position.x, position.y);
    }
    refresh(context) {
        const record = this.record;
        if (!record) {
            return;
        }
        if (this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            && record.peerPosition) {
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
        if (record.state === PARCEL_HANDOFF_STATE.PICKING
            && context.parcels.get(record.candidate.parcelId)?.carriedBy
                === context.agentId) {
            this.setState(record, PARCEL_HANDOFF_STATE.WAITING_FOR_READY);
        }
        if (record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_READY
            && record.readyMessage
            && this.receiverIsVerified(context, record)) {
            record.readyAcknowledged = true;
            void this.channel.send(AgentCommunicationMessageFactory
                .parcelHandoffReadyAcknowledgement(record.handoffId, record.candidate.parcelId, record.readyMessage.messageId));
            this.setState(record, PARCEL_HANDOFF_STATE.RELEASING);
        }
        if (this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.MOVING_TO_STAGING
            && context.agentPosition.isEqual(record.candidate.stagingCell)) {
            this.becomeReady(record);
        }
        if (this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.COLLECTING
            && context.parcels.get(record.candidate.parcelId)?.carriedBy
                === context.agentId) {
            this.confirmCollection(record);
        }
    }
    instruction(context) {
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
    completeInstruction(instruction, context) {
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
                .parcelHandoffAvailable(record.handoffId, candidate.parcelId, candidate.handoffCell);
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
        if (instruction.type === "deliver"
            && context.parcels.get(candidate.parcelId)?.carriedBy
                !== context.agentId) {
            void this.channel.send(AgentCommunicationMessageFactory.parcelHandoffDelivered(record.handoffId, candidate.parcelId));
            this.complete(record);
        }
    }
    reservedParcelIds() {
        const record = this.record;
        if (this.localRole !== AGENT_ROLE.LLM
            || !record?.candidate
            || record.peerCollected
            || record.state === PARCEL_HANDOFF_STATE.COMPLETED) {
            return new Set();
        }
        return new Set([record.candidate.parcelId]);
    }
    consumeCompletedHandoffIds() {
        return this.completedHandoffIds.splice(0, this.completedHandoffIds.length);
    }
    snapshot() {
        return this.record ? {
            handoffId: this.record.handoffId,
            parcelId: this.record.candidate?.parcelId,
            state: this.record.state,
            candidate: this.record.candidate,
        } : undefined;
    }
    subscribeStateChanges(handler) {
        this.stateChangeHandlers.add(handler);
    }
    handleMessage(peer, message) {
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
    handleRequest(peer, message) {
        if (this.localRole !== AGENT_ROLE.BDI || !this.latestPosition) {
            return;
        }
        if (this.record?.handoffId === message.handoffId) {
            if (this.record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT) {
                void this.channel.send(AgentCommunicationMessageFactory.parcelHandoffStatus(message.handoffId, message.messageId, this.latestPosition));
            }
            return;
        }
        this.record = this.makeRecord(message.handoffId, message.reward, PARCEL_HANDOFF_STATE.WAITING_FOR_ASSIGNMENT);
        this.record.peerId = peer.id;
        void this.channel.send(AgentCommunicationMessageFactory.parcelHandoffStatus(message.handoffId, message.messageId, this.latestPosition));
        this.publishStateChange();
    }
    handleStatus(peer, message) {
        const record = this.record;
        if (this.localRole !== AGENT_ROLE.LLM
            || !record
            || record.state !== PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            || record.handoffId !== message.handoffId
            || record.requestMessage?.messageId
                !== message.acknowledgedMessageId) {
            return;
        }
        record.peerId = peer.id;
        record.peerPosition = this.toPosition(message.position);
        this.publishStateChange();
    }
    handleAssignment(peer, message) {
        if (this.localRole !== AGENT_ROLE.BDI) {
            return;
        }
        if (this.record?.handoffId === message.handoffId
            && this.record.candidate?.parcelId === message.parcelId) {
            return;
        }
        const record = this.makeRecord(message.handoffId, message.reward, PARCEL_HANDOFF_STATE.MOVING_TO_STAGING);
        record.peerId = peer.id;
        record.candidate = this.candidateFromAssignment(message);
        record.assignmentMessage = message;
        this.record = record;
        this.publishStateChange();
    }
    handleReady(peer, message) {
        const record = this.matchingRecord(message.handoffId, message.parcelId);
        if (this.localRole !== AGENT_ROLE.LLM || !record) {
            return;
        }
        if (record.state === PARCEL_HANDOFF_STATE.RELEASING
            || record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION) {
            void this.channel.send(AgentCommunicationMessageFactory
                .parcelHandoffReadyAcknowledgement(record.handoffId, message.parcelId, message.messageId));
            return;
        }
        if (record.readyMessage?.messageId === message.messageId) {
            return;
        }
        record.peerId = peer.id;
        record.readyMessage = message;
        this.publishStateChange();
    }
    handleReadyAcknowledgement(handoffId) {
        const record = this.record;
        if (this.localRole === AGENT_ROLE.BDI
            && record?.handoffId === handoffId
            && record.state === PARCEL_HANDOFF_STATE.READY) {
            record.readyAcknowledged = true;
        }
    }
    handleAvailable(message) {
        const record = this.matchingRecord(message.handoffId, message.parcelId);
        if (this.localRole !== AGENT_ROLE.BDI
            || !record
            || record.state !== PARCEL_HANDOFF_STATE.READY) {
            return;
        }
        this.setState(record, PARCEL_HANDOFF_STATE.COLLECTING);
    }
    handleCollected(handoffId, parcelId) {
        const record = this.matchingRecord(handoffId, parcelId);
        if (this.localRole !== AGENT_ROLE.LLM || !record) {
            return;
        }
        record.peerCollected = true;
        this.publishStateChange();
    }
    handleDelivered(handoffId, parcelId) {
        const record = this.matchingRecord(handoffId, parcelId);
        if (this.localRole === AGENT_ROLE.LLM && record) {
            this.complete(record);
        }
    }
    assignCandidate(record, candidate) {
        record.candidate = candidate;
        record.assignmentMessage = AgentCommunicationMessageFactory
            .parcelHandoffAssignment(record.handoffId, record.reward, candidate.parcelId, candidate.handoffCell, candidate.stagingCell, candidate.escapeCell, candidate.deliveryCell);
        void this.channel.send(record.assignmentMessage);
        this.setState(record, PARCEL_HANDOFF_STATE.PICKING);
    }
    becomeReady(record) {
        const candidate = record.candidate;
        if (!candidate || !this.latestPosition) {
            return;
        }
        record.readyMessage = AgentCommunicationMessageFactory
            .parcelHandoffReady(record.handoffId, candidate.parcelId, this.latestPosition);
        void this.channel.send(record.readyMessage);
        this.setState(record, PARCEL_HANDOFF_STATE.READY);
    }
    confirmCollection(record) {
        const candidate = record.candidate;
        if (!candidate) {
            return;
        }
        void this.channel.send(AgentCommunicationMessageFactory.parcelHandoffCollected(record.handoffId, candidate.parcelId));
        this.setState(record, PARCEL_HANDOFF_STATE.DELIVERING);
    }
    receiverIsVerified(context, record) {
        const candidate = record.candidate;
        const ready = record.readyMessage;
        if (!candidate
            || !ready
            || !this.toPosition(ready.position).isEqual(candidate.stagingCell)
            || candidate.handoffCell.distanceTo(candidate.stagingCell) !== 1) {
            return false;
        }
        return record.peerId !== undefined
            && this.agentAt(context, record.peerId, candidate.stagingCell);
    }
    agentAt(context, agentId, position) {
        const agent = context.sensedAgents.get(agentId);
        return agent !== undefined
            && Math.round(agent.x) === position.x
            && Math.round(agent.y) === position.y;
    }
    retryPendingMessage() {
        const record = this.record;
        if (!record) {
            return;
        }
        if (this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_STATUS
            && record.requestMessage) {
            void this.channel.send(record.requestMessage);
        }
        else if (this.localRole === AGENT_ROLE.LLM
            && (record.state === PARCEL_HANDOFF_STATE.PICKING
                || record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_READY)
            && record.assignmentMessage) {
            void this.channel.send(record.assignmentMessage);
        }
        else if (this.localRole === AGENT_ROLE.BDI
            && record.state === PARCEL_HANDOFF_STATE.READY
            && !record.readyAcknowledged
            && record.readyMessage) {
            void this.channel.send(record.readyMessage);
        }
        else if (this.localRole === AGENT_ROLE.LLM
            && record.state === PARCEL_HANDOFF_STATE.WAITING_FOR_COLLECTION
            && !record.peerCollected
            && record.availableMessage) {
            void this.channel.send(record.availableMessage);
        }
    }
    candidateFromAssignment(message) {
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
    matchingRecord(handoffId, parcelId) {
        return this.record?.handoffId === handoffId
            && this.record.candidate?.parcelId === parcelId
            ? this.record
            : undefined;
    }
    complete(record) {
        if (record.state === PARCEL_HANDOFF_STATE.COMPLETED) {
            return;
        }
        record.state = PARCEL_HANDOFF_STATE.COMPLETED;
        this.completedHandoffIds.push(record.handoffId);
        this.publishStateChange();
    }
    setState(record, state) {
        if (record.state === state) {
            return;
        }
        record.state = state;
        this.publishStateChange();
    }
    makeRecord(handoffId, reward, state) {
        return {
            handoffId,
            reward,
            state,
            peerPosition: undefined,
            peerId: undefined,
            candidate: undefined,
            requestMessage: undefined,
            assignmentMessage: undefined,
            readyMessage: undefined,
            readyAcknowledged: false,
            availableMessage: undefined,
            peerCollected: false,
        };
    }
    toPosition(position) {
        return new Position(position.x, position.y);
    }
    publishStateChange() {
        for (const handler of this.stateChangeHandlers) {
            handler();
        }
    }
}
//# sourceMappingURL=_coordinator.js.map