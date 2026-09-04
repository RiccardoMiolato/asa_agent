import { GameMap } from "../utils/map.js";
import { Position } from "../utils/position.js";
/** Confidence attached to local pickup ownership. */
export var PICKUP_CONFIDENCE;
(function (PICKUP_CONFIDENCE) {
    PICKUP_CONFIDENCE["PROVISIONAL"] = "provisional";
    PICKUP_CONFIDENCE["CONFIRMED"] = "confirmed";
})(PICKUP_CONFIDENCE || (PICKUP_CONFIDENCE = {}));
/** Finite set of dynamic world changes reported by one sensing revision. */
export var BELIEF_CHANGE_TYPE;
(function (BELIEF_CHANGE_TYPE) {
    BELIEF_CHANGE_TYPE["PARCEL_DISCOVERED"] = "parcel-discovered";
    BELIEF_CHANGE_TYPE["PARCEL_REWARD_CHANGED"] = "parcel-reward-changed";
    BELIEF_CHANGE_TYPE["PARCEL_CARRIER_CHANGED"] = "parcel-carrier-changed";
    BELIEF_CHANGE_TYPE["PARCEL_MOVED"] = "parcel-moved";
    BELIEF_CHANGE_TYPE["PARCEL_DISAPPEARED"] = "parcel-disappeared";
    BELIEF_CHANGE_TYPE["PARCEL_EXPIRED"] = "parcel-expired";
    BELIEF_CHANGE_TYPE["CRATE_DISCOVERED"] = "crate-discovered";
    BELIEF_CHANGE_TYPE["CRATE_MOVED"] = "crate-moved";
})(BELIEF_CHANGE_TYPE || (BELIEF_CHANGE_TYPE = {}));
/** Detailed result of applying one authoritative sensing snapshot. */
export class BeliefRevision {
    constructor(changes) {
        this.changes = changes;
    }
    hasChanges() {
        return this.changes.length > 0;
    }
}
export class Beliefs {
    // TODO add player position and id to the believes
    constructor() {
        this.map = new GameMap([]);
        this.agents = new Map();
        this.parcels = new Map();
        this.crates = new Map();
        this.pendingPickupAttempts = new Map();
        this.localPickupOwnership =
            new Map();
        this.locallyDeliveredParcelIds = new Set();
        this.sensingRevision = 0;
        this.crateRevisionNumber = 0;
        this.mapRevisionNumber = 0;
        this.observedPositionKeys = new Set();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.pickupCellKeys = new Set();
        this.pickupCellLastObservedAt = new Map();
        this.movement_duration = 0;
        this.frame_duration = 0;
        this.observation_distance = -1;
        this.rewardDecayInterval = 1000;
        this.lastRewardDecayAt = undefined;
    }
    /** Revises all dynamic beliefs from one complete sensing snapshot. */
    revise(parcels, crates, observedPositions = [], agents = []) {
        return this.reviseWithChanges(parcels, crates, observedPositions, agents).hasChanges();
    }
    /** Revises beliefs and identifies every planning-relevant state change. */
    reviseWithChanges(parcels, crates, observedPositions = [], agents = []) {
        this.agents = new Map(agents.map((agent) => [
            agent.id,
            agent,
        ]));
        this.observedPositionKeys = new Set(observedPositions.map((position) => this.positionKey(position)));
        const changes = [
            ...this.senseParcelChanges(parcels),
            ...this.senseCrateChanges(crates),
        ];
        this.recordObservedPickupCells(observedPositions);
        this.recordSensingRevision();
        return new BeliefRevision(changes);
    }
    /** Monotonically identifies the last complete sensing snapshot. */
    currentSensingRevision() {
        return this.sensingRevision;
    }
    recordSensingRevision() {
        this.sensingRevision += 1;
    }
    /** Changes whenever a crate is discovered or moves to another cell. */
    currentCrateRevision() {
        return this.crateRevisionNumber;
    }
    /** Monotonically identifies the currently configured static map. */
    currentMapRevision() {
        return this.mapRevisionNumber;
    }
    /** Reports whether the latest complete snapshot covered a grid cell. */
    isPositionCurrentlyObserved(position) {
        return this.observedPositionKeys.has(this.positionKey(position));
    }
    configPhase(config) {
        this.map = new GameMap(config.GAME.map.tiles);
        this.mapRevisionNumber += 1;
        this.movement_duration = config.GAME.player.movement_duration;
        this.frame_duration = config.CLOCK;
        this.observation_distance = config.GAME.player.observation_distance;
        this.rewardDecayInterval = Beliefs.clockEventIntervalMilliseconds(config.GAME.parcels?.decaying_event ?? "1s", this.frame_duration);
        this.lastRewardDecayAt = undefined;
        const rows = this.map.getRows();
        const cols = this.map.getCols();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.pickupCellKeys.clear();
        this.pickupCellLastObservedAt.clear();
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const cellPos = new Position(row, col);
                const cell = this.map.getCellValue(cellPos);
                if (cell == '2') {
                    this.delivering_cells.push(cellPos); // Map is rotated of 90 degree in the game
                }
                else if (cell == '1') {
                    this.pickup_cells.push(cellPos); // Map is rotated of 90 degree in the game
                    this.pickupCellKeys.add(this.positionKey(cellPos));
                }
            }
        }
    }
    /** Returns the last authoritative sensing time for each observed pickup cell. */
    pickupCellObservationTimes() {
        return this.pickupCellLastObservedAt;
    }
    recordObservedPickupCells(observedPositions) {
        const observedAt = Date.now();
        for (const observedPosition of observedPositions) {
            const key = this.positionKey(observedPosition);
            if (this.pickupCellKeys.has(key)) {
                this.pickupCellLastObservedAt.set(key, observedAt);
            }
        }
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
    /** Revises parcel beliefs from the current sensing snapshot. */
    senseParcels(parcels) {
        return this.senseParcelChanges(parcels).length > 0;
    }
    senseParcelChanges(parcels) {
        const changes = [];
        const sensedParcelIds = new Set(parcels.map((parcel) => parcel.id));
        parcels.forEach((parcel) => {
            const { id, x, y, reward } = parcel;
            if (this.locallyDeliveredParcelIds.has(id)) {
                return;
            }
            const carriedBy = this.reconcileSensedParcelCarrier(id, parcel.carriedBy ?? undefined);
            const lastUpdate = new Date();
            const existingParcel = this.parcels.get(id);
            if (existingParcel && reward < existingParcel.reward) {
                this.lastRewardDecayAt = lastUpdate.getTime();
            }
            if (reward <= 0) {
                this.parcels.delete(id);
                this.localPickupOwnership.delete(id);
                if (existingParcel !== undefined) {
                    changes.push({
                        type: BELIEF_CHANGE_TYPE.PARCEL_EXPIRED,
                        parcelId: id,
                    });
                }
                if (existingParcel && existingParcel.reward !== reward) {
                    changes.push({
                        type: BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED,
                        parcelId: id,
                        previousReward: existingParcel.reward,
                        currentReward: reward,
                    });
                }
                return;
            }
            this.parcels.set(id, { id, x, y, carriedBy, reward, lastUpdate });
            if (!existingParcel) {
                changes.push({
                    type: BELIEF_CHANGE_TYPE.PARCEL_DISCOVERED,
                    parcelId: id,
                });
                return;
            }
            if (existingParcel.reward !== reward) {
                changes.push({
                    type: BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED,
                    parcelId: id,
                    previousReward: existingParcel.reward,
                    currentReward: reward,
                });
            }
            if (existingParcel.carriedBy !== carriedBy) {
                changes.push({
                    type: BELIEF_CHANGE_TYPE.PARCEL_CARRIER_CHANGED,
                    parcelId: id,
                    previousCarrier: existingParcel.carriedBy,
                    currentCarrier: carriedBy,
                });
            }
            if (carriedBy === undefined
                && (existingParcel.x !== x || existingParcel.y !== y)) {
                changes.push({
                    type: BELIEF_CHANGE_TYPE.PARCEL_MOVED,
                    parcelId: id,
                    previousPosition: new Position(existingParcel.x, existingParcel.y),
                    currentPosition: new Position(x, y),
                });
            }
        });
        for (const [parcelId, parcel] of this.parcels) {
            const targetIsObserved = this.isPositionCurrentlyObserved(new Position(parcel.x, parcel.y));
            const pendingPickup = this.pendingPickupAttempts.get(parcelId);
            if (!sensedParcelIds.has(parcelId)
                && targetIsObserved
                && pendingPickup !== undefined) {
                pendingPickup.observedTargetAbsent = true;
                continue;
            }
            if (sensedParcelIds.has(parcelId)
                || this.localPickupOwnership.has(parcelId)
                || !targetIsObserved) {
                continue;
            }
            this.parcels.delete(parcelId);
            changes.push({
                type: BELIEF_CHANGE_TYPE.PARCEL_DISAPPEARED,
                parcelId,
            });
        }
        for (const parcelId of this.updateParcelRewards()) {
            changes.push({
                type: BELIEF_CHANGE_TYPE.PARCEL_EXPIRED,
                parcelId,
            });
        }
        return changes;
    }
    /** Protects a target parcel from disappearing while pickup is unresolved. */
    beginPickupAttempt(parcelId, agentId) {
        this.pendingPickupAttempts.set(parcelId, {
            agentId,
            observedTargetAbsent: false,
        });
    }
    /**
     * Ends pickup protection and removes a target observed absent when the
     * pickup request itself did not complete.
     */
    endPickupAttempt(parcelId, pickupCompleted) {
        const pendingPickup = this.pendingPickupAttempts.get(parcelId);
        this.pendingPickupAttempts.delete(parcelId);
        if (pickupCompleted
            || pendingPickup?.observedTargetAbsent !== true) {
            return;
        }
        this.parcels.delete(parcelId);
        this.localPickupOwnership.delete(parcelId);
    }
    /** Returns stable identities of parcels currently assigned to this agent. */
    carriedParcelIds(agentId) {
        return [...this.parcels.values()]
            .filter((parcel) => parcel.carriedBy === agentId)
            .map((parcel) => parcel.id);
    }
    /** Confirms local ownership and makes it resilient to stale sensing. */
    markParcelCarried(parcelId, agentId) {
        const parcel = this.parcels.get(parcelId);
        if (parcel === undefined) {
            return;
        }
        parcel.carriedBy = agentId;
        this.localPickupOwnership.set(parcelId, {
            agentId,
            confidence: PICKUP_CONFIDENCE.CONFIRMED,
        });
    }
    /** Assumes local ownership until a later observation contradicts it. */
    markParcelProvisionallyCarried(parcelId, agentId) {
        const parcel = this.parcels.get(parcelId);
        if (parcel === undefined
            || (parcel.carriedBy !== undefined
                && parcel.carriedBy !== agentId)) {
            return;
        }
        const existingOwnership = this.localPickupOwnership.get(parcelId);
        parcel.carriedBy = agentId;
        if (existingOwnership?.agentId === agentId
            && existingOwnership.confidence === PICKUP_CONFIDENCE.CONFIRMED) {
            return;
        }
        this.localPickupOwnership.set(parcelId, {
            agentId,
            confidence: PICKUP_CONFIDENCE.PROVISIONAL,
        });
    }
    /** Whether the canonical belief currently assigns a parcel to one agent. */
    isParcelCarriedBy(parcelId, agentId) {
        return this.parcels.get(parcelId)?.carriedBy === agentId;
    }
    /** Records a deliberate non-delivery putdown at a handoff cell. */
    markParcelDropped(parcelId, agentId, position) {
        const parcel = this.parcels.get(parcelId);
        const ownership = this.localPickupOwnership.get(parcelId);
        if (parcel?.carriedBy !== agentId
            && ownership?.agentId !== agentId) {
            return;
        }
        if (parcel) {
            parcel.x = position.x;
            parcel.y = position.y;
            parcel.carriedBy = undefined;
            parcel.lastUpdate = new Date();
        }
        this.localPickupOwnership.delete(parcelId);
        this.pendingPickupAttempts.delete(parcelId);
        this.locallyDeliveredParcelIds.delete(parcelId);
    }
    /** Returns this agent's local ownership confidence for one parcel. */
    parcelPickupConfidence(parcelId, agentId) {
        const ownership = this.localPickupOwnership.get(parcelId);
        return ownership?.agentId === agentId
            ? ownership.confidence
            : undefined;
    }
    /**
     * Records parcels delivered by the agent after a planned putdown and
     * prevents stale sensing frames from resurrecting them.
     */
    markParcelsDelivered(agentId, parcelIds) {
        for (const parcelId of parcelIds) {
            const parcel = this.parcels.get(parcelId);
            const ownership = this.localPickupOwnership.get(parcelId);
            if (parcel?.carriedBy !== agentId
                && ownership?.agentId !== agentId) {
                continue;
            }
            this.parcels.delete(parcelId);
            this.localPickupOwnership.delete(parcelId);
            this.pendingPickupAttempts.delete(parcelId);
            this.locallyDeliveredParcelIds.add(parcelId);
        }
    }
    /** Reconciles authoritative carrier data with confirmed local ownership. */
    reconcileSensedParcelCarrier(parcelId, sensedCarrier) {
        const pendingPickupAgent = this.pendingPickupAttempts.get(parcelId)?.agentId;
        if (pendingPickupAgent !== undefined
            && sensedCarrier === pendingPickupAgent) {
            this.localPickupOwnership.set(parcelId, {
                agentId: pendingPickupAgent,
                confidence: PICKUP_CONFIDENCE.CONFIRMED,
            });
            return pendingPickupAgent;
        }
        const ownership = this.localPickupOwnership.get(parcelId);
        if (ownership === undefined) {
            return sensedCarrier;
        }
        if (sensedCarrier === ownership.agentId) {
            this.localPickupOwnership.set(parcelId, {
                agentId: ownership.agentId,
                confidence: PICKUP_CONFIDENCE.CONFIRMED,
            });
            return ownership.agentId;
        }
        if (ownership.confidence === PICKUP_CONFIDENCE.CONFIRMED
            && sensedCarrier === undefined) {
            return ownership.agentId;
        }
        this.localPickupOwnership.delete(parcelId);
        return sensedCarrier;
    }
    /** Applies decay ticks and returns identities that expired locally. */
    updateParcelRewards() {
        const rewardDecayInterval = this.rewardDecayInterval;
        if (rewardDecayInterval === undefined) {
            return [];
        }
        const timeNow = new Date();
        const expiredParcelIds = [];
        this.parcels.forEach((parcel, id) => {
            const elapsedMilliseconds = timeNow.getTime() - parcel.lastUpdate.getTime();
            const elapsedTicks = Math.floor(elapsedMilliseconds / rewardDecayInterval);
            if (elapsedTicks === 0) {
                return;
            }
            parcel.reward = Math.max(0, parcel.reward - elapsedTicks);
            parcel.lastUpdate = new Date(parcel.lastUpdate.getTime()
                + elapsedTicks * rewardDecayInterval);
            if (parcel.reward <= 0) {
                this.parcels.delete(id);
                this.localPickupOwnership.delete(id);
                expiredParcelIds.push(id);
            }
        });
        return expiredParcelIds;
    }
    /** Returns a latency-adjusted delay until the next server reward-decay tick. */
    millisecondsUntilNextRewardDecay() {
        if (this.rewardDecayInterval === undefined
            || this.lastRewardDecayAt === undefined) {
            return undefined;
        }
        const elapsed = Date.now() - this.lastRewardDecayAt;
        const elapsedInCurrentInterval = elapsed % this.rewardDecayInterval;
        const delayFromObservedSnapshot = this.rewardDecayInterval
            - elapsedInCurrentInterval;
        return Math.max(0, delayFromObservedSnapshot - this.frame_duration);
    }
    /** Returns the configured time between parcel reward decrements. */
    rewardDecayIntervalMilliseconds() {
        return this.rewardDecayInterval;
    }
    static clockEventIntervalMilliseconds(event, frameDuration) {
        switch (event) {
            case "frame":
                return frameDuration;
            case "1s":
                return 1000;
            case "2s":
                return 2000;
            case "5s":
                return 5000;
            case "10s":
                return 10000;
            case "1m":
                return 60000;
            case "1h":
                return 3600000;
            case "infinite":
                return undefined;
        }
    }
    // Sense the crates
    senseCrates(crates) {
        return this.senseCrateChanges(crates).length > 0;
    }
    senseCrateChanges(crates) {
        const changes = [];
        crates.forEach((crate) => {
            const id = crate.id;
            const position = new Position(crate.x, crate.y);
            if (!this.hasCrate(id)) {
                this.addCrate(id, position);
                changes.push({
                    type: BELIEF_CHANGE_TYPE.CRATE_DISCOVERED,
                    crateId: id,
                    position,
                });
            }
            else {
                // If the crate has been moved then I update the position
                if (!this.crates.get(id)?.isEqual(position)) {
                    this.crates.set(id, position);
                    this.crateRevisionNumber += 1;
                    changes.push({
                        type: BELIEF_CHANGE_TYPE.CRATE_MOVED,
                        crateId: id,
                        position,
                    });
                }
            }
        });
        return changes;
    }
    // Add a crate to the map
    addCrate(id, position) {
        this.crates.set(id, position);
        this.crateRevisionNumber += 1;
    }
    // Check if a crate exists
    hasCrate(id) {
        return this.crates.has(id);
    }
    // Update the movement duration
    updateMovementDuration(duration) {
        this.movement_duration = duration;
    }
}
//# sourceMappingURL=beliefs.js.map