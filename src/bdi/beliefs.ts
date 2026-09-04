import type { IOClockEvent } from "../../types/IOClockEvent.js";
import type { IOConfig } from "../../types/IOConfig.js";
import type { IOCrate } from "../../types/IOCrate.js";
import type { IOParcel } from "../../types/IOParcel.js";
import type {
    IOSensedAgent,
    IOSensedPosition,
} from "../../types/IOSensing.js";
import { GameMap } from "../utils/map.js";
import { Position } from "../utils/position.js";

/** Canonical internal parcel state; an absent carrier is always `undefined`. */
export interface Parcel extends Omit<IOParcel, "carriedBy"> {
    carriedBy?: string;
    lastUpdate: Date;
}

/** Confidence attached to local pickup ownership. */
export enum PICKUP_CONFIDENCE {
    PROVISIONAL = "provisional",
    CONFIRMED = "confirmed",
}

/** Local ownership inferred from pickup execution or direct evidence. */
interface LocalPickupOwnership {
    readonly agentId: string;
    readonly confidence: PICKUP_CONFIDENCE;
}

/** In-flight pickup evidence collected from complete sensing revisions. */
interface PendingPickupAttempt {
    readonly agentId: string;
    observedTargetAbsent: boolean;
}

/** Finite set of dynamic world changes reported by one sensing revision. */
export enum BELIEF_CHANGE_TYPE {
    PARCEL_DISCOVERED = "parcel-discovered",
    PARCEL_REWARD_CHANGED = "parcel-reward-changed",
    PARCEL_CARRIER_CHANGED = "parcel-carrier-changed",
    PARCEL_MOVED = "parcel-moved",
    PARCEL_DISAPPEARED = "parcel-disappeared",
    PARCEL_EXPIRED = "parcel-expired",
    CRATE_DISCOVERED = "crate-discovered",
    CRATE_MOVED = "crate-moved",
}

export type BeliefChange =
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_DISCOVERED;
        readonly parcelId: string;
    }
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED;
        readonly parcelId: string;
        readonly previousReward: number;
        readonly currentReward: number;
    }
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_CARRIER_CHANGED;
        readonly parcelId: string;
        readonly previousCarrier: string | undefined;
        readonly currentCarrier: string | undefined;
    }
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_MOVED;
        readonly parcelId: string;
        readonly previousPosition: Position;
        readonly currentPosition: Position;
    }
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_DISAPPEARED;
        readonly parcelId: string;
    }
    | {
        readonly type: BELIEF_CHANGE_TYPE.PARCEL_EXPIRED;
        readonly parcelId: string;
    }
    | {
        readonly type:
            | BELIEF_CHANGE_TYPE.CRATE_DISCOVERED
            | BELIEF_CHANGE_TYPE.CRATE_MOVED;
        readonly crateId: string;
        readonly position: Position;
    };

/** Detailed result of applying one authoritative sensing snapshot. */
export class BeliefRevision {
    constructor(readonly changes: readonly BeliefChange[]) { }

    hasChanges(): boolean {
        return this.changes.length > 0;
    }
}

export class Beliefs {
    map: GameMap;

    // OBJECT POSITIONS
    agents: Map<string, IOSensedAgent>;
    parcels: Map<string, Parcel>;
    crates: Map<string, Position>;
    private readonly pendingPickupAttempts: Map<string, PendingPickupAttempt>;
    private readonly localPickupOwnership:
        Map<string, LocalPickupOwnership>;
    private readonly locallyDeliveredParcelIds: Set<string>;
    private sensingRevision: number;
    private crateRevisionNumber: number;
    private mapRevisionNumber: number;
    private observedPositionKeys: Set<string>;


    // MAP LOCATIONS
    delivering_cells: Position[];
    pickup_cells: Position[];
    private readonly pickupCellKeys: Set<string>;
    private readonly pickupCellLastObservedAt: Map<string, number>;

    // TIMER FOR MOVES
    movement_duration: number;
    frame_duration: number;
    observation_distance: number;
    private rewardDecayInterval: number | undefined;
    private lastRewardDecayAt: number | undefined;
    // TODO add player position and id to the believes

    constructor() {
        this.map = new GameMap([]);
        this.agents = new Map<string, IOSensedAgent>();
        this.parcels = new Map<string, Parcel>();
        this.crates = new Map<string, Position>();
        this.pendingPickupAttempts = new Map<string, PendingPickupAttempt>();
        this.localPickupOwnership =
            new Map<string, LocalPickupOwnership>();
        this.locallyDeliveredParcelIds = new Set<string>();
        this.sensingRevision = 0;
        this.crateRevisionNumber = 0;
        this.mapRevisionNumber = 0;
        this.observedPositionKeys = new Set<string>();
        this.delivering_cells = [];
        this.pickup_cells = [];
        this.pickupCellKeys = new Set<string>();
        this.pickupCellLastObservedAt = new Map<string, number>();
        this.movement_duration = 0;
        this.frame_duration = 0;
        this.observation_distance = -1;
        this.rewardDecayInterval = 1_000;
        this.lastRewardDecayAt = undefined;
    }

    /** Revises all dynamic beliefs from one complete sensing snapshot. */
    revise(
        parcels: IOParcel[],
        crates: IOCrate[],
        observedPositions: readonly IOSensedPosition[] = [],
        agents: readonly IOSensedAgent[] = [],
    ): boolean {
        return this.reviseWithChanges(
            parcels,
            crates,
            observedPositions,
            agents,
        ).hasChanges();
    }

    /** Revises beliefs and identifies every planning-relevant state change. */
    reviseWithChanges(
        parcels: IOParcel[],
        crates: IOCrate[],
        observedPositions: readonly IOSensedPosition[] = [],
        agents: readonly IOSensedAgent[] = [],
    ): BeliefRevision {
        this.agents = new Map<string, IOSensedAgent>(
            agents.map((agent: IOSensedAgent): [string, IOSensedAgent] => [
                agent.id,
                agent,
            ]),
        );
        this.observedPositionKeys = new Set<string>(
            observedPositions.map(
                (position: IOSensedPosition): string => this.positionKey(position),
            ),
        );

        const changes = [
            ...this.senseParcelChanges(parcels),
            ...this.senseCrateChanges(crates),
        ];
        this.recordObservedPickupCells(observedPositions);
        this.recordSensingRevision();

        return new BeliefRevision(changes);
    }

    /** Monotonically identifies the last complete sensing snapshot. */
    currentSensingRevision(): number {
        return this.sensingRevision;
    }

    private recordSensingRevision(): void {
        this.sensingRevision += 1;
    }

    /** Changes whenever a crate is discovered or moves to another cell. */
    currentCrateRevision(): number {
        return this.crateRevisionNumber;
    }

    /** Monotonically identifies the currently configured static map. */
    currentMapRevision(): number {
        return this.mapRevisionNumber;
    }

    /** Reports whether the latest complete snapshot covered a grid cell. */
    isPositionCurrentlyObserved(position: Position): boolean {
        return this.observedPositionKeys.has(this.positionKey(position));
    }

    configPhase(config: IOConfig): void {
        this.map = new GameMap(config.GAME.map.tiles);
        this.mapRevisionNumber += 1;
        this.movement_duration = config.GAME.player.movement_duration;
        this.frame_duration = config.CLOCK;
        this.observation_distance = config.GAME.player.observation_distance;
        this.rewardDecayInterval = Beliefs.clockEventIntervalMilliseconds(
            config.GAME.parcels?.decaying_event ?? "1s",
            this.frame_duration,
        );
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
                } else if (cell == '1') {
                    this.pickup_cells.push(cellPos); // Map is rotated of 90 degree in the game
                    this.pickupCellKeys.add(this.positionKey(cellPos));
                }
            }
        }
    }

    /** Returns the last authoritative sensing time for each observed pickup cell. */
    pickupCellObservationTimes(): ReadonlyMap<string, number> {
        return this.pickupCellLastObservedAt;
    }

    private recordObservedPickupCells(
        observedPositions: readonly IOSensedPosition[],
    ): void {
        const observedAt = Date.now();
        for (const observedPosition of observedPositions) {
            const key = this.positionKey(observedPosition);
            if (this.pickupCellKeys.has(key)) {
                this.pickupCellLastObservedAt.set(key, observedAt);
            }
        }
    }

    private positionKey(position: IOSensedPosition): string {
        return `${position.x},${position.y}`;
    }

    /** Revises parcel beliefs from the current sensing snapshot. */
    senseParcels(parcels: IOParcel[]): boolean {
        return this.senseParcelChanges(parcels).length > 0;
    }

    private senseParcelChanges(parcels: IOParcel[]): BeliefChange[] {
        const changes: BeliefChange[] = [];
        const sensedParcelIds = new Set<string>(
            parcels.map((parcel: IOParcel): string => parcel.id),
        );

        parcels.forEach((parcel: IOParcel) => {
            const { id, x, y, reward } = parcel;
            if (this.locallyDeliveredParcelIds.has(id)) {
                return;
            }

            const carriedBy = this.reconcileSensedParcelCarrier(
                id,
                parcel.carriedBy ?? undefined,
            );
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
            if (
                carriedBy === undefined
                && (existingParcel.x !== x || existingParcel.y !== y)
            ) {
                changes.push({
                    type: BELIEF_CHANGE_TYPE.PARCEL_MOVED,
                    parcelId: id,
                    previousPosition: new Position(
                        existingParcel.x,
                        existingParcel.y,
                    ),
                    currentPosition: new Position(x, y),
                });
            }
        });

        for (const [parcelId, parcel] of this.parcels) {
            const targetIsObserved = this.isPositionCurrentlyObserved(
                new Position(parcel.x, parcel.y),
            );
            const pendingPickup = this.pendingPickupAttempts.get(parcelId);
            if (
                !sensedParcelIds.has(parcelId)
                && targetIsObserved
                && pendingPickup !== undefined
            ) {
                pendingPickup.observedTargetAbsent = true;
                continue;
            }

            if (
                sensedParcelIds.has(parcelId)
                || this.localPickupOwnership.has(parcelId)
                || !targetIsObserved
            ) {
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
    beginPickupAttempt(parcelId: string, agentId: string): void {
        this.pendingPickupAttempts.set(parcelId, {
            agentId,
            observedTargetAbsent: false,
        });
    }

    /**
     * Ends pickup protection and removes a target observed absent when the
     * pickup request itself did not complete.
     */
    endPickupAttempt(parcelId: string, pickupCompleted: boolean): void {
        const pendingPickup = this.pendingPickupAttempts.get(parcelId);
        this.pendingPickupAttempts.delete(parcelId);
        if (
            pickupCompleted
            || pendingPickup?.observedTargetAbsent !== true
        ) {
            return;
        }

        this.parcels.delete(parcelId);
        this.localPickupOwnership.delete(parcelId);
    }

    /** Returns stable identities of parcels currently assigned to this agent. */
    carriedParcelIds(agentId: string): readonly string[] {
        return [...this.parcels.values()]
            .filter((parcel: Parcel): boolean => parcel.carriedBy === agentId)
            .map((parcel: Parcel): string => parcel.id);
    }

    /** Confirms local ownership and makes it resilient to stale sensing. */
    markParcelCarried(parcelId: string, agentId: string): void {
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
    markParcelProvisionallyCarried(
        parcelId: string,
        agentId: string,
    ): void {
        const parcel = this.parcels.get(parcelId);
        if (
            parcel === undefined
            || (
                parcel.carriedBy !== undefined
                && parcel.carriedBy !== agentId
            )
        ) {
            return;
        }

        const existingOwnership = this.localPickupOwnership.get(parcelId);
        parcel.carriedBy = agentId;
        if (
            existingOwnership?.agentId === agentId
            && existingOwnership.confidence === PICKUP_CONFIDENCE.CONFIRMED
        ) {
            return;
        }
        this.localPickupOwnership.set(parcelId, {
            agentId,
            confidence: PICKUP_CONFIDENCE.PROVISIONAL,
        });
    }

    /** Whether the canonical belief currently assigns a parcel to one agent. */
    isParcelCarriedBy(parcelId: string, agentId: string): boolean {
        return this.parcels.get(parcelId)?.carriedBy === agentId;
    }

    /** Records a deliberate non-delivery putdown at a handoff cell. */
    markParcelDropped(
        parcelId: string,
        agentId: string,
        position: Position,
    ): void {
        const parcel = this.parcels.get(parcelId);
        const ownership = this.localPickupOwnership.get(parcelId);
        if (
            parcel?.carriedBy !== agentId
            && ownership?.agentId !== agentId
        ) {
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
    parcelPickupConfidence(
        parcelId: string,
        agentId: string,
    ): PICKUP_CONFIDENCE | undefined {
        const ownership = this.localPickupOwnership.get(parcelId);
        return ownership?.agentId === agentId
            ? ownership.confidence
            : undefined;
    }

    /**
     * Records parcels delivered by the agent after a planned putdown and
     * prevents stale sensing frames from resurrecting them.
     */
    markParcelsDelivered(
        agentId: string,
        parcelIds: ReadonlySet<string>,
    ): void {
        for (const parcelId of parcelIds) {
            const parcel = this.parcels.get(parcelId);
            const ownership = this.localPickupOwnership.get(parcelId);
            if (
                parcel?.carriedBy !== agentId
                && ownership?.agentId !== agentId
            ) {
                continue;
            }

            this.parcels.delete(parcelId);
            this.localPickupOwnership.delete(parcelId);
            this.pendingPickupAttempts.delete(parcelId);
            this.locallyDeliveredParcelIds.add(parcelId);
        }
    }

    /** Reconciles authoritative carrier data with confirmed local ownership. */
    private reconcileSensedParcelCarrier(
        parcelId: string,
        sensedCarrier: string | undefined,
    ): string | undefined {
        const pendingPickupAgent =
            this.pendingPickupAttempts.get(parcelId)?.agentId;
        if (
            pendingPickupAgent !== undefined
            && sensedCarrier === pendingPickupAgent
        ) {
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
        if (
            ownership.confidence === PICKUP_CONFIDENCE.CONFIRMED
            && sensedCarrier === undefined
        ) {
            return ownership.agentId;
        }

        this.localPickupOwnership.delete(parcelId);
        return sensedCarrier;
    }

    /** Applies decay ticks and returns identities that expired locally. */
    updateParcelRewards(): readonly string[] {
        const rewardDecayInterval = this.rewardDecayInterval;
        if (rewardDecayInterval === undefined) {
            return [];
        }

        const timeNow = new Date();
        const expiredParcelIds: string[] = [];

        this.parcels.forEach((parcel: Parcel, id: string) => {
            const elapsedMilliseconds = timeNow.getTime() - parcel.lastUpdate.getTime();
            const elapsedTicks = Math.floor(
                elapsedMilliseconds / rewardDecayInterval,
            );
            if (elapsedTicks === 0) {
                return;
            }

            parcel.reward = Math.max(0, parcel.reward - elapsedTicks);
            parcel.lastUpdate = new Date(
                parcel.lastUpdate.getTime()
                + elapsedTicks * rewardDecayInterval,
            );

            if (parcel.reward <= 0) {
                this.parcels.delete(id);
                this.localPickupOwnership.delete(id);
                expiredParcelIds.push(id);
            }
        });

        return expiredParcelIds;
    }

    /** Returns a latency-adjusted delay until the next server reward-decay tick. */
    millisecondsUntilNextRewardDecay(): number | undefined {
        if (
            this.rewardDecayInterval === undefined
            || this.lastRewardDecayAt === undefined
        ) {
            return undefined;
        }

        const elapsed = Date.now() - this.lastRewardDecayAt;
        const elapsedInCurrentInterval = elapsed % this.rewardDecayInterval;
        const delayFromObservedSnapshot = this.rewardDecayInterval
            - elapsedInCurrentInterval;
        return Math.max(0, delayFromObservedSnapshot - this.frame_duration);
    }

    /** Returns the configured time between parcel reward decrements. */
    rewardDecayIntervalMilliseconds(): number | undefined {
        return this.rewardDecayInterval;
    }

    private static clockEventIntervalMilliseconds(
        event: IOClockEvent,
        frameDuration: number,
    ): number | undefined {
        switch (event) {
            case "frame":
                return frameDuration;
            case "1s":
                return 1_000;
            case "2s":
                return 2_000;
            case "5s":
                return 5_000;
            case "10s":
                return 10_000;
            case "1m":
                return 60_000;
            case "1h":
                return 3_600_000;
            case "infinite":
                return undefined;
        }
    }

    // Sense the crates
    senseCrates(crates: IOCrate[]): boolean {
        return this.senseCrateChanges(crates).length > 0;
    }

    private senseCrateChanges(crates: IOCrate[]): BeliefChange[] {
        const changes: BeliefChange[] = [];

        crates.forEach((crate: IOCrate) => {
            const id = crate.id;
            const position = new Position(crate.x, crate.y);

            if (!this.hasCrate(id)) {
                this.addCrate(id, position);
                changes.push({
                    type: BELIEF_CHANGE_TYPE.CRATE_DISCOVERED,
                    crateId: id,
                    position,
                });
            } else {
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
    private addCrate(id: string, position: Position): void {
        this.crates.set(id, position);
        this.crateRevisionNumber += 1;
    }

    // Check if a crate exists
    private hasCrate(id: string): boolean {
        return this.crates.has(id);
    }

    // Update the movement duration
    updateMovementDuration(duration: number): void {
        this.movement_duration = duration;
    }

}
