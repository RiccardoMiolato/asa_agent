import type { IOSensedAgent } from "../types/IOSensing.js";
import type {
    BaseAgentLogger,
    MovementSafetyEvent,
    MovementSafetyReason,
} from "./_logging.js";
import type { Beliefs } from "./beliefs.js";
import { Position } from "./position.js";

interface ObservedMovement {
    readonly source: Position;
    readonly destination: Position;
}

interface AwaitingDeparture {
    readonly phase: "awaiting-departure";
    readonly arrivalObservedAt: number;
    readonly agentName: string;
    readonly lastObservationKey: string;
    readonly stationarySince?: number;
    readonly stationaryPosition?: Position;
}

interface AwaitingNextDirection {
    readonly phase: "awaiting-next-direction";
    readonly departureDestination: Position;
    readonly departureObservedAt: number;
    readonly agentName: string;
    readonly lastObservationKey: string;
    readonly stationarySince?: number;
    readonly stationaryPosition?: Position;
}

type MovementBlocker = AwaitingDeparture | AwaitingNextDirection;

export type MovementClearance =
    | { readonly decision: "move" }
    | { readonly decision: "replan"; readonly blockedCell: Position };

/**
 * Prevents a move until nearby-agent trajectories prove its destination safe.
 *
 * The server first reports a move 0.6 cells after its source, so rounding gives
 * the destination and the other endpoint gives the source.
 */
export class ConservativeMovementGuard {
    private static readonly STATIONARY_WAIT_TICKS = 2;

    constructor(
        private readonly beliefs: Beliefs,
        private readonly logger: BaseAgentLogger,
    ) { }

    async waitUntilSafe(destination: Position): Promise<MovementClearance> {
        const blockers = new Map<string, MovementBlocker>();
        this.addCurrentBlockers(destination, blockers);

        let sensingRevision = this.beliefs.currentSensingRevision();
        while (blockers.size > 0) {
            const timeoutMilliseconds = this.millisecondsUntilReplan(blockers);
            const nextRevision = timeoutMilliseconds === undefined
                ? await this.beliefs.waitForSensingAfter(sensingRevision)
                : await this.beliefs.waitForSensingAfterOrTimeout(
                    sensingRevision,
                    timeoutMilliseconds,
                );
            if (nextRevision === undefined) {
                const replan = this.replanForExpiredBlocker(blockers, destination);
                if (replan) {
                    return replan;
                }
                continue;
            }
            sensingRevision = nextRevision;
            const replan = this.updateBlockers(destination, blockers);
            if (replan) {
                return replan;
            }
            this.addCurrentBlockers(destination, blockers);
        }
        return { decision: "move" };
    }

    private addCurrentBlockers(
        destination: Position,
        blockers: Map<string, MovementBlocker>,
    ): void {
        for (const agent of this.beliefs.agents.values()) {
            if (blockers.has(agent.id)) {
                continue;
            }

            const movement = this.observedMovement(agent);
            if (movement?.source.isEqual(destination)) {
                blockers.set(agent.id, {
                    phase: "awaiting-next-direction",
                    departureDestination: movement.destination,
                    departureObservedAt: Date.now(),
                    agentName: agent.name,
                    lastObservationKey: this.observationKey(agent),
                });
                this.logObservation(
                    "encountered",
                    agent,
                    destination,
                    movement,
                    "wait",
                    "agent-moving-from-next-cell",
                );
            } else if (
                movement?.destination.isEqual(destination)
                || this.stationaryPosition(agent)?.isEqual(destination)
            ) {
                const stationaryPosition = this.stationaryPosition(agent);
                blockers.set(agent.id, {
                    phase: "awaiting-departure",
                    arrivalObservedAt: Date.now(),
                    agentName: agent.name,
                    lastObservationKey: this.observationKey(agent),
                    ...(stationaryPosition
                        ? this.stationaryState(stationaryPosition)
                        : {}),
                });
                this.logObservation(
                    "encountered",
                    agent,
                    destination,
                    movement,
                    "wait",
                    movement
                        ? "agent-moving-to-next-cell"
                        : "agent-on-next-cell",
                );
            }
        }
    }

    private updateBlockers(
        destination: Position,
        blockers: Map<string, MovementBlocker>,
    ): MovementClearance | undefined {
        for (const [agentId, blocker] of blockers) {
            const agent = this.beliefs.agents.get(agentId);
            if (!agent) {
                if (this.beliefs.isPositionCurrentlyObserved(destination)) {
                    blockers.delete(agentId);
                    this.logger.logMovementSafety({
                        event: "cleared",
                        agentId,
                        agentName: blocker.agentName,
                        nextCell: destination,
                        observedPosition: undefined,
                        movementSource: undefined,
                        movementDestination: undefined,
                        decision: "move",
                        reason: "agent-left-observation-range",
                    });
                    continue;
                }
                if (blocker.lastObservationKey !== "not-visible") {
                    this.logger.logMovementSafety({
                        event: "observed",
                        agentId,
                        agentName: blocker.agentName,
                        nextCell: destination,
                        observedPosition: undefined,
                        movementSource: undefined,
                        movementDestination: undefined,
                        decision: "wait",
                        reason: "agent-not-visible",
                    });
                    blockers.set(agentId, {
                        ...blocker,
                        lastObservationKey: "not-visible",
                    });
                }
                continue;
            }

            const observationKey = this.observationKey(agent);
            if (observationKey === blocker.lastObservationKey) {
                continue;
            }

            const movement = this.observedMovement(agent);
            const stationaryPosition = this.stationaryPosition(agent);
            if (blocker.phase === "awaiting-departure") {
                if (movement?.source.isEqual(destination)) {
                    blockers.set(agentId, {
                        phase: "awaiting-next-direction",
                        departureDestination: movement.destination,
                        departureObservedAt: Date.now(),
                        agentName: agent.name,
                        lastObservationKey: observationKey,
                    });
                    this.logObservation(
                        "observed",
                        agent,
                        destination,
                        movement,
                        "wait",
                        "agent-moving-from-next-cell",
                    );
                    continue;
                }
                if (
                    movement?.destination.isEqual(destination)
                    || stationaryPosition?.isEqual(destination)
                ) {
                    blockers.set(agentId, {
                        ...blocker,
                        lastObservationKey: observationKey,
                        ...(stationaryPosition
                            ? this.stationaryState(
                                stationaryPosition,
                                blocker,
                            )
                            : {
                                stationarySince: undefined,
                                stationaryPosition: undefined,
                            }),
                    });
                    this.logObservation(
                        "observed",
                        agent,
                        destination,
                        movement,
                        "wait",
                        movement
                            ? "agent-moving-to-next-cell"
                            : "agent-on-next-cell",
                    );
                    continue;
                }

                if (movement) {
                    blockers.delete(agentId);
                    this.logObservation(
                        "cleared",
                        agent,
                        destination,
                        movement,
                        "move",
                        "next-move-is-safe",
                    );
                    continue;
                }
                if (stationaryPosition) {
                    if (stationaryPosition.distanceTo(destination) === 1) {
                        blockers.set(agentId, {
                            phase: "awaiting-next-direction",
                            departureDestination: stationaryPosition,
                            departureObservedAt: Date.now(),
                            agentName: agent.name,
                            lastObservationKey: observationKey,
                            ...this.stationaryState(stationaryPosition),
                        });
                        this.logObservation(
                            "observed",
                            agent,
                            destination,
                            movement,
                            "wait",
                            "departure-completed",
                        );
                    } else {
                        blockers.delete(agentId);
                        this.logObservation(
                            "cleared",
                            agent,
                            destination,
                            movement,
                            "move",
                            "next-move-is-safe",
                        );
                    }
                    continue;
                }

                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                });
                this.logObservation(
                    "observed",
                    agent,
                    destination,
                    movement,
                    "wait",
                    "movement-uncertain",
                );
                continue;
            }

            if (stationaryPosition?.isEqual(destination)) {
                this.logObservation(
                    "replanned",
                    agent,
                    destination,
                    movement,
                    "replan",
                    "agent-oscillating-replan",
                );
                return { decision: "replan", blockedCell: destination };
            }
            if (!movement) {
                if (
                    stationaryPosition
                    && !stationaryPosition.isEqual(
                        blocker.departureDestination,
                    )
                ) {
                    blockers.delete(agentId);
                    this.logObservation(
                        "cleared",
                        agent,
                        destination,
                        movement,
                        "move",
                        "next-move-is-safe",
                    );
                    continue;
                }
                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                    ...(stationaryPosition
                        ? this.stationaryState(stationaryPosition, blocker)
                        : {}),
                });
                this.logObservation(
                    "observed",
                    agent,
                    destination,
                    movement,
                    "wait",
                    stationaryPosition?.isEqual(blocker.departureDestination)
                        ? "departure-completed"
                        : "movement-uncertain",
                );
                continue;
            }
            if (movement.destination.isEqual(destination)) {
                this.logObservation(
                    "replanned",
                    agent,
                    destination,
                    movement,
                    "replan",
                    "agent-oscillating-replan",
                );
                return { decision: "replan", blockedCell: destination };
            }
            if (
                movement.source.isEqual(destination)
                && movement.destination.isEqual(
                    blocker.departureDestination,
                )
            ) {
                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                });
                this.logObservation(
                    "observed",
                    agent,
                    destination,
                    movement,
                    "wait",
                    "agent-moving-from-next-cell",
                );
                continue;
            }

            blockers.delete(agentId);
            this.logObservation(
                "cleared",
                agent,
                destination,
                movement,
                "move",
                "next-move-is-safe",
            );
        }
        return undefined;
    }

    private millisecondsUntilReplan(
        blockers: ReadonlyMap<string, MovementBlocker>,
    ): number | undefined {
        let earliestDeadline: number | undefined;
        for (const blocker of blockers.values()) {
            const waitingSince = blocker.stationarySince
                ?? (blocker.phase === "awaiting-next-direction"
                    ? blocker.departureObservedAt
                    : blocker.arrivalObservedAt);
            const deadline = waitingSince + this.stationaryWaitDuration();
            earliestDeadline = earliestDeadline === undefined
                ? deadline
                : Math.min(earliestDeadline, deadline);
        }
        return earliestDeadline === undefined
            ? undefined
            : Math.max(0, earliestDeadline - Date.now());
    }

    private replanForExpiredBlocker(
        blockers: ReadonlyMap<string, MovementBlocker>,
        nextCell: Position,
    ): MovementClearance | undefined {
        const timeNow = Date.now();
        const waitDuration = this.stationaryWaitDuration();
        for (const [agentId, blocker] of blockers) {
            if (
                blocker.stationarySince !== undefined
                && blocker.stationaryPosition !== undefined
                && timeNow - blocker.stationarySince >= waitDuration
            ) {
                this.logger.logMovementSafety({
                    event: "replanned",
                    agentId,
                    agentName: blocker.agentName,
                    nextCell,
                    observedPosition: blocker.stationaryPosition,
                    movementSource: undefined,
                    movementDestination: undefined,
                    decision: "replan",
                    reason: "agent-stationary-replan",
                });
                return {
                    decision: "replan",
                    blockedCell: blocker.stationaryPosition,
                };
            }
            if (blocker.phase === "awaiting-departure") {
                if (timeNow - blocker.arrivalObservedAt < waitDuration) {
                    continue;
                }

                this.logger.logMovementSafety({
                    event: "replanned",
                    agentId,
                    agentName: blocker.agentName,
                    nextCell,
                    observedPosition: nextCell,
                    movementSource: undefined,
                    movementDestination: nextCell,
                    decision: "replan",
                    reason: "movement-uncertain-replan",
                });
                return { decision: "replan", blockedCell: nextCell };
            }
            if (timeNow - blocker.departureObservedAt < waitDuration) {
                continue;
            }

            this.logger.logMovementSafety({
                event: "replanned",
                agentId,
                agentName: blocker.agentName,
                nextCell,
                observedPosition: blocker.departureDestination,
                movementSource: nextCell,
                movementDestination: blocker.departureDestination,
                decision: "replan",
                reason: "movement-uncertain-replan",
            });
            return { decision: "replan", blockedCell: nextCell };
        }
        return undefined;
    }

    private stationaryWaitDuration(): number {
        return Math.max(
            1,
            this.beliefs.frame_duration,
            ConservativeMovementGuard.STATIONARY_WAIT_TICKS
                * this.beliefs.movement_duration,
        );
    }

    private stationaryState(
        position: Position,
        previous?: MovementBlocker,
    ): {
        readonly stationarySince: number;
        readonly stationaryPosition: Position;
    } {
        const sameStationaryPosition = previous?.stationaryPosition
            ?.isEqual(position) ?? false;
        return {
            stationarySince: sameStationaryPosition
                ? previous!.stationarySince ?? Date.now()
                : Date.now(),
            stationaryPosition: position,
        };
    }

    private logObservation(
        event: MovementSafetyEvent,
        agent: IOSensedAgent,
        nextCell: Position,
        movement: ObservedMovement | undefined,
        decision: "wait" | "move" | "replan",
        reason: MovementSafetyReason,
    ): void {
        this.logger.logMovementSafety({
            event,
            agentId: agent.id,
            agentName: agent.name,
            nextCell,
            observedPosition: new Position(agent.x, agent.y),
            movementSource: movement?.source,
            movementDestination: movement?.destination,
            decision,
            reason,
        });
    }

    private observationKey(agent: IOSensedAgent): string {
        return `${agent.x},${agent.y}`;
    }

    private observedMovement(agent: IOSensedAgent): ObservedMovement | undefined {
        const xIsInteger = Number.isInteger(agent.x);
        const yIsInteger = Number.isInteger(agent.y);
        if (xIsInteger === yIsInteger) {
            return undefined;
        }

        const destination = new Position(
            Math.round(agent.x),
            Math.round(agent.y),
        );
        if (!xIsInteger) {
            const sourceX = agent.x < destination.x
                ? destination.x - 1
                : destination.x + 1;
            return {
                source: new Position(sourceX, destination.y),
                destination,
            };
        }

        const sourceY = agent.y < destination.y
            ? destination.y - 1
            : destination.y + 1;
        return {
            source: new Position(destination.x, sourceY),
            destination,
        };
    }

    private stationaryPosition(agent: IOSensedAgent): Position | undefined {
        if (!Number.isInteger(agent.x) || !Number.isInteger(agent.y)) {
            return undefined;
        }
        return new Position(agent.x, agent.y);
    }
}
