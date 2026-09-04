import { AGENT_COMMUNICATION_PEER_STATUS, AGENT_ROLE, AgentCommunicationMessageFactory, PEER_MESSAGE_TYPE, } from "../../../communication/index.js";
import { SCORE_EFFECT_LIFETIME } from "../../../_score-effect-lifetime.js";
import { CellScoreEffect } from "../../../utils/_cell-score-effects.js";
import { Position } from "../../../utils/position.js";
import { GridPositionObjective } from "./_position-objective.js";
/** State of one local participant in the rendezvous protocol. */
export var RENDEZVOUS_COORDINATION_STATE;
(function (RENDEZVOUS_COORDINATION_STATE) {
    RENDEZVOUS_COORDINATION_STATE["CONSIDERING"] = "considering";
    RENDEZVOUS_COORDINATION_STATE["PROPOSING"] = "proposing";
    RENDEZVOUS_COORDINATION_STATE["COMMITTED"] = "committed";
    RENDEZVOUS_COORDINATION_STATE["WAITING_FOR_PEER"] = "waiting-for-peer";
    RENDEZVOUS_COORDINATION_STATE["WAITING_FOR_RELEASE"] = "waiting-for-release";
    RENDEZVOUS_COORDINATION_STATE["COMPLETED"] = "completed";
})(RENDEZVOUS_COORDINATION_STATE || (RENDEZVOUS_COORDINATION_STATE = {}));
/** Contract connecting rendezvous communication to an autonomous planner. */
export class BaseRendezvousCoordinator {
}
/** Reliable two-peer rendezvous state machine over the shared agent channel. */
export class PeerRendezvousCoordinator extends BaseRendezvousCoordinator {
    constructor(channel, localRole, retryMilliseconds = 1000, resolveGridPosition = undefined) {
        super();
        this.channel = channel;
        this.localRole = localRole;
        this.retryMilliseconds = retryMilliseconds;
        this.resolveGridPosition = resolveGridPosition;
        this.records = new Map();
        this.stateChangeHandlers = new Set();
        this.completedRendezvousIds = [];
        this.started = false;
        if (!Number.isFinite(retryMilliseconds) || retryMilliseconds <= 0) {
            throw new RangeError("Rendezvous retry duration must be finite and positive");
        }
        this.messageHandler = (peer, message) => this.handleMessage(peer, message);
        this.peerStatusHandler = (_peer, status) => {
            if (status === AGENT_COMMUNICATION_PEER_STATUS.CONNECTED) {
                void this.retryPendingMessages();
            }
        };
    }
    start() {
        if (this.started) {
            throw new Error("The rendezvous coordinator is already started");
        }
        this.started = true;
        this.channel.subscribe(this.messageHandler);
        this.channel.subscribePeerStatus(this.peerStatusHandler);
        this.retryTimer = setInterval(() => void this.retryPendingMessages(), this.retryMilliseconds);
    }
    stop() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = undefined;
        }
        this.channel.unsubscribe(this.messageHandler);
        this.channel.unsubscribePeerStatus(this.peerStatusHandler);
        this.started = false;
    }
    propose(plan) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            throw new Error("Only the LLM agent can propose a rendezvous");
        }
        if (this.records.has(plan.rendezvousId)) {
            throw new Error(`Duplicate rendezvous ${plan.rendezvousId}`);
        }
        const assignmentMessage = AgentCommunicationMessageFactory.rendezvousAssignment(plan.rendezvousId, plan.reward, plan.llmAgentTarget, plan.bdiAgentTarget);
        this.records.set(plan.rendezvousId, {
            rendezvousId: plan.rendezvousId,
            reward: plan.reward,
            localTarget: plan.llmAgentTarget,
            peerTarget: plan.bdiAgentTarget,
            localObjective: undefined,
            assignmentMessage,
            formationProposalMessage: undefined,
            peerObjective: undefined,
            receivedFormationProposalMessage: undefined,
            formationAcceptanceMessage: undefined,
            requiresExternalRelease: false,
            state: RENDEZVOUS_COORDINATION_STATE.PROPOSING,
            peerArrived: false,
            arrivalAcknowledged: false,
            arrivalMessage: undefined,
            releaseMessage: undefined,
            commitmentWaiters: new Set(),
            completionWaiters: new Set(),
        });
        void this.channel.send(assignmentMessage);
    }
    /** Registers an abstract formation without contacting the peer yet. */
    considerGridFormation(plan) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            throw new Error("Only the LLM agent can introduce a grid formation");
        }
        if (this.records.has(plan.rendezvousId)) {
            throw new Error(`Duplicate rendezvous ${plan.rendezvousId}`);
        }
        this.records.set(plan.rendezvousId, {
            rendezvousId: plan.rendezvousId,
            reward: plan.reward,
            localTarget: undefined,
            peerTarget: undefined,
            localObjective: plan.llmAgentObjective,
            assignmentMessage: undefined,
            formationProposalMessage: undefined,
            peerObjective: plan.bdiAgentObjective,
            receivedFormationProposalMessage: undefined,
            formationAcceptanceMessage: undefined,
            requiresExternalRelease: true,
            state: RENDEZVOUS_COORDINATION_STATE.CONSIDERING,
            peerArrived: false,
            arrivalAcknowledged: false,
            arrivalMessage: undefined,
            releaseMessage: undefined,
            commitmentWaiters: new Set(),
            completionWaiters: new Set(),
        });
    }
    /** Freezes the currently selected target and starts or accepts negotiation. */
    commitSelectedGridFormation(effectId, target) {
        const record = [...this.records.values()].find((candidate) => candidate.state === RENDEZVOUS_COORDINATION_STATE.CONSIDERING
            && this.gridFormationEffectId(candidate) === effectId);
        if (!record
            || !record.localObjective?.matches(target.x, target.y)
            || record.peerTarget?.isEqual(target)) {
            return false;
        }
        if (this.localRole === AGENT_ROLE.LLM) {
            const peerObjective = record.peerObjective;
            if (!peerObjective) {
                return false;
            }
            record.localTarget = new Position(target.x, target.y);
            record.formationProposalMessage =
                AgentCommunicationMessageFactory.gridFormationProposal(record.rendezvousId, record.reward, record.localTarget, record.localObjective.describe(), peerObjective.describe());
            record.state = RENDEZVOUS_COORDINATION_STATE.PROPOSING;
            void this.channel.send(record.formationProposalMessage);
        }
        else {
            const proposal = record.receivedFormationProposalMessage;
            if (!proposal) {
                return false;
            }
            record.localTarget = new Position(target.x, target.y);
            record.formationAcceptanceMessage =
                AgentCommunicationMessageFactory.gridFormationAcceptance(record.rendezvousId, proposal.messageId, record.localTarget);
            record.state = RENDEZVOUS_COORDINATION_STATE.COMMITTED;
            void this.channel.send(record.formationAcceptanceMessage);
        }
        this.publishStateChange();
        return true;
    }
    /** Blocks a selected proposer until its peer accepts the frozen target. */
    async waitForGridFormationCommit() {
        const proposingRecords = [...this.records.values()].filter((record) => record.state === RENDEZVOUS_COORDINATION_STATE.PROPOSING
            && record.localObjective !== undefined);
        await Promise.all(proposingRecords.map((record) => new Promise((resolve) => {
            if (record.state
                !== RENDEZVOUS_COORDINATION_STATE.PROPOSING) {
                resolve();
                return;
            }
            record.commitmentWaiters.add(resolve);
        })));
    }
    isGridFormationEffect(effectId) {
        return [...this.records.values()].some((record) => record.localObjective !== undefined
            && this.gridFormationEffectId(record) === effectId);
    }
    observePosition(position) {
        this.latestPosition = new Position(position.x, position.y);
        for (const record of this.records.values()) {
            if (record.state !== RENDEZVOUS_COORDINATION_STATE.COMMITTED
                || !record.localTarget
                || !position.isEqual(record.localTarget)) {
                continue;
            }
            record.arrivalMessage =
                AgentCommunicationMessageFactory.rendezvousArrived(this.localRole, record.rendezvousId, record.localTarget);
            record.arrivalAcknowledged = false;
            if (record.peerArrived) {
                this.completeOrWaitForRelease(record);
            }
            else {
                record.state =
                    RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER;
                this.publishStateChange();
            }
            void this.channel.send(record.arrivalMessage);
        }
    }
    activeScoreEffects() {
        const effects = [];
        for (const record of this.records.values()) {
            let target;
            if (record.state === RENDEZVOUS_COORDINATION_STATE.COMMITTED) {
                target = record.localTarget;
            }
            else if (record.state === RENDEZVOUS_COORDINATION_STATE.CONSIDERING
                && record.localObjective
                && this.resolveGridPosition
                && this.latestPosition) {
                target = this.resolveGridPosition(record.localObjective, this.latestPosition, record.peerTarget ? [record.peerTarget] : []);
            }
            if (!target) {
                continue;
            }
            effects.push(new CellScoreEffect(record.localObjective
                ? this.gridFormationEffectId(record)
                : `rendezvous:${record.rendezvousId}:${this.localRole}`, target, record.reward, SCORE_EFFECT_LIFETIME.ONE_SHOT, record.localObjective !== undefined));
        }
        return effects;
    }
    isWaitingForPeer() {
        return [...this.records.values()].some((record) => record.state
            === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER
            || record.state
                === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE);
    }
    async waitForPeer() {
        const waitingRecords = [...this.records.values()].filter((record) => record.state
            === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER
            || record.state
                === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE);
        await Promise.all(waitingRecords.map((record) => new Promise((resolve) => {
            if (record.state
                === RENDEZVOUS_COORDINATION_STATE.COMPLETED) {
                resolve();
                return;
            }
            record.completionWaiters.add(resolve);
        })));
    }
    /** Sends a reliable green light for every arrived grid formation. */
    releaseWaitingGridFormations() {
        if (this.localRole !== AGENT_ROLE.LLM) {
            return false;
        }
        let released = false;
        for (const record of this.records.values()) {
            if (!record.requiresExternalRelease
                || (record.state
                    !== RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER
                    && record.state
                        !== RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE)
                || record.releaseMessage) {
                continue;
            }
            record.releaseMessage =
                AgentCommunicationMessageFactory.gridFormationRelease(record.rendezvousId);
            void this.channel.send(record.releaseMessage);
            released = true;
        }
        return released;
    }
    consumeCompletedRendezvousIds() {
        return this.completedRendezvousIds.splice(0, this.completedRendezvousIds.length);
    }
    snapshots() {
        return [...this.records.values()].map((record) => ({
            rendezvousId: record.rendezvousId,
            localTarget: record.localTarget,
            peerTarget: record.peerTarget,
            reward: record.reward,
            state: record.state,
            peerArrived: record.peerArrived,
            arrivalAcknowledged: record.arrivalAcknowledged,
        }));
    }
    subscribeStateChanges(handler) {
        this.stateChangeHandlers.add(handler);
    }
    async handleMessage(_peer, message) {
        if (message.role === this.localRole) {
            return;
        }
        switch (message.type) {
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ASSIGNMENT:
                await this.handleAssignment(message);
                return;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ACKNOWLEDGEMENT:
                this.handleAcknowledgement(message);
                return;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_PROPOSAL:
                await this.handleGridFormationProposal(message);
                return;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_ACCEPTANCE:
                this.handleGridFormationAcceptance(message);
                return;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE:
                await this.handleGridFormationRelease(message);
                return;
            case PEER_MESSAGE_TYPE.GRID_FORMATION_RELEASE_ACKNOWLEDGEMENT:
                this.handleGridFormationReleaseAcknowledgement(message);
                return;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVED:
                await this.handlePeerArrival(message);
                return;
            case PEER_MESSAGE_TYPE.RENDEZVOUS_ARRIVAL_ACKNOWLEDGEMENT:
                this.handleArrivalAcknowledgement(message);
                return;
            default:
                return;
        }
    }
    async handleAssignment(message) {
        if (this.localRole !== AGENT_ROLE.BDI) {
            return;
        }
        let record = this.records.get(message.rendezvousId);
        if (!record) {
            record = {
                rendezvousId: message.rendezvousId,
                reward: message.reward,
                localTarget: new Position(message.bdiAgentTarget.x, message.bdiAgentTarget.y),
                peerTarget: new Position(message.llmAgentTarget.x, message.llmAgentTarget.y),
                localObjective: undefined,
                assignmentMessage: undefined,
                formationProposalMessage: undefined,
                peerObjective: undefined,
                receivedFormationProposalMessage: undefined,
                formationAcceptanceMessage: undefined,
                requiresExternalRelease: false,
                state: RENDEZVOUS_COORDINATION_STATE.COMMITTED,
                peerArrived: false,
                arrivalAcknowledged: false,
                arrivalMessage: undefined,
                releaseMessage: undefined,
                commitmentWaiters: new Set(),
                completionWaiters: new Set(),
            };
            this.records.set(message.rendezvousId, record);
            this.publishStateChange();
        }
        await this.channel.send(AgentCommunicationMessageFactory.rendezvousAcknowledgement(message.rendezvousId, message.messageId));
        if (record.arrivalMessage && !record.arrivalAcknowledged) {
            await this.channel.send(record.arrivalMessage);
        }
    }
    handleAcknowledgement(message) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            return;
        }
        const record = this.records.get(message.rendezvousId);
        if (!record
            || record.state !== RENDEZVOUS_COORDINATION_STATE.PROPOSING
            || record.assignmentMessage?.messageId
                !== message.acknowledgedMessageId) {
            return;
        }
        record.state = RENDEZVOUS_COORDINATION_STATE.COMMITTED;
        this.publishStateChange();
    }
    async handlePeerArrival(message) {
        const record = this.records.get(message.rendezvousId);
        if (!record
            || !record.peerTarget
            || record.peerTarget.x !== message.position.x
            || record.peerTarget.y !== message.position.y) {
            return;
        }
        await this.channel.send(AgentCommunicationMessageFactory
            .rendezvousArrivalAcknowledgement(this.localRole, message.rendezvousId, message.messageId));
        record.peerArrived = true;
        if (record.state
            === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER) {
            this.completeOrWaitForRelease(record);
            return;
        }
    }
    handleArrivalAcknowledgement(message) {
        const record = this.records.get(message.rendezvousId);
        if (!record
            || record.arrivalMessage?.messageId
                !== message.acknowledgedMessageId) {
            return;
        }
        record.arrivalAcknowledged = true;
    }
    complete(record) {
        record.state = RENDEZVOUS_COORDINATION_STATE.COMPLETED;
        this.completedRendezvousIds.push(record.rendezvousId);
        for (const resolve of record.completionWaiters) {
            resolve();
        }
        record.completionWaiters.clear();
        this.publishStateChange();
    }
    async retryPendingMessages() {
        for (const record of this.records.values()) {
            if (record.state === RENDEZVOUS_COORDINATION_STATE.PROPOSING
                && record.assignmentMessage) {
                await this.channel.send(record.assignmentMessage);
            }
            if (record.state === RENDEZVOUS_COORDINATION_STATE.PROPOSING
                && record.formationProposalMessage) {
                await this.channel.send(record.formationProposalMessage);
            }
            if ((record.state
                === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER
                || record.state
                    === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE)
                && record.releaseMessage) {
                await this.channel.send(record.releaseMessage);
            }
            if ((record.state
                === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_PEER
                || record.state
                    === RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE
                || record.state
                    === RENDEZVOUS_COORDINATION_STATE.COMPLETED)
                && record.arrivalMessage
                && !record.arrivalAcknowledged) {
                await this.channel.send(record.arrivalMessage);
            }
        }
    }
    publishStateChange() {
        for (const handler of this.stateChangeHandlers) {
            handler();
        }
    }
    async handleGridFormationProposal(message) {
        if (this.localRole !== AGENT_ROLE.BDI) {
            return;
        }
        let record = this.records.get(message.rendezvousId);
        if (!record) {
            const bdiObjective = GridPositionObjective.parse(message.bdiAgentObjective);
            const llmObjective = GridPositionObjective.parse(message.llmAgentObjective);
            if (!bdiObjective
                || !llmObjective
                || !llmObjective.matches(message.llmAgentTarget.x, message.llmAgentTarget.y)) {
                return;
            }
            record = {
                rendezvousId: message.rendezvousId,
                reward: message.reward,
                localTarget: undefined,
                peerTarget: new Position(message.llmAgentTarget.x, message.llmAgentTarget.y),
                localObjective: bdiObjective,
                assignmentMessage: undefined,
                formationProposalMessage: undefined,
                peerObjective: undefined,
                receivedFormationProposalMessage: message,
                formationAcceptanceMessage: undefined,
                requiresExternalRelease: true,
                state: RENDEZVOUS_COORDINATION_STATE.CONSIDERING,
                peerArrived: false,
                arrivalAcknowledged: false,
                arrivalMessage: undefined,
                releaseMessage: undefined,
                commitmentWaiters: new Set(),
                completionWaiters: new Set(),
            };
            this.records.set(message.rendezvousId, record);
            this.publishStateChange();
        }
        if (record.formationAcceptanceMessage) {
            await this.channel.send(record.formationAcceptanceMessage);
        }
    }
    handleGridFormationAcceptance(message) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            return;
        }
        const record = this.records.get(message.rendezvousId);
        if (!record
            || record.state !== RENDEZVOUS_COORDINATION_STATE.PROPOSING
            || record.formationProposalMessage?.messageId
                !== message.acknowledgedMessageId
            || !record.peerObjective?.matches(message.bdiAgentTarget.x, message.bdiAgentTarget.y)
            || !record.localTarget
            || record.localTarget.x === message.bdiAgentTarget.x
                && record.localTarget.y === message.bdiAgentTarget.y) {
            return;
        }
        record.peerTarget = new Position(message.bdiAgentTarget.x, message.bdiAgentTarget.y);
        record.state = RENDEZVOUS_COORDINATION_STATE.COMMITTED;
        for (const resolve of record.commitmentWaiters) {
            resolve();
        }
        record.commitmentWaiters.clear();
        this.publishStateChange();
    }
    async handleGridFormationRelease(message) {
        if (this.localRole !== AGENT_ROLE.BDI) {
            return;
        }
        const record = this.records.get(message.rendezvousId);
        if (!record
            || !record.requiresExternalRelease
            || record.state
                !== RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE
                && record.state
                    !== RENDEZVOUS_COORDINATION_STATE.COMPLETED) {
            return;
        }
        await this.channel.send(AgentCommunicationMessageFactory
            .gridFormationReleaseAcknowledgement(message.rendezvousId, message.messageId));
        if (record.state !== RENDEZVOUS_COORDINATION_STATE.COMPLETED) {
            this.complete(record);
        }
    }
    handleGridFormationReleaseAcknowledgement(message) {
        if (this.localRole !== AGENT_ROLE.LLM) {
            return;
        }
        const record = this.records.get(message.rendezvousId);
        if (!record
            || record.state
                !== RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE
            || record.releaseMessage?.messageId
                !== message.acknowledgedMessageId) {
            return;
        }
        this.complete(record);
    }
    completeOrWaitForRelease(record) {
        if (record.requiresExternalRelease) {
            record.state = RENDEZVOUS_COORDINATION_STATE.WAITING_FOR_RELEASE;
            this.publishStateChange();
            return;
        }
        this.complete(record);
    }
    gridFormationEffectId(record) {
        return `grid-formation:${record.rendezvousId}:${this.localRole}`;
    }
}
//# sourceMappingURL=_coordinator.js.map