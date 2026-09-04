import { Position } from "./position.js";
/**
 * Prevents a move until nearby-agent trajectories prove its destination safe.
 *
 * The server first reports a move 0.6 cells after its source, so rounding gives
 * the destination and the other endpoint gives the source.
 */
export class ConservativeMovementGuard {
    constructor(beliefs, logger) {
        this.beliefs = beliefs;
        this.logger = logger;
    }
    async waitUntilSafe(destination) {
        const blockers = new Map();
        this.addCurrentBlockers(destination, blockers);
        let sensingRevision = this.beliefs.currentSensingRevision();
        while (blockers.size > 0) {
            const timeoutMilliseconds = this.millisecondsUntilReplan(blockers);
            const nextRevision = timeoutMilliseconds === undefined
                ? await this.beliefs.waitForSensingAfter(sensingRevision)
                : await this.beliefs.waitForSensingAfterOrTimeout(sensingRevision, timeoutMilliseconds);
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
    addCurrentBlockers(destination, blockers) {
        for (const agent of this.beliefs.agents.values()) {
            if (blockers.has(agent.id)) {
                continue;
            }
            const movement = this.observedMovement(agent);
            if (movement?.source.isEqual(destination)) {
                blockers.set(agent.id, {
                    phase: "awaiting-next-direction",
                    departureDestination: movement.destination,
                    agentName: agent.name,
                    lastObservationKey: this.observationKey(agent),
                });
                this.logObservation("encountered", agent, destination, movement, "wait", "agent-moving-from-next-cell");
            }
            else if (movement?.destination.isEqual(destination)
                || this.stationaryPosition(agent)?.isEqual(destination)) {
                const stationaryPosition = this.stationaryPosition(agent);
                blockers.set(agent.id, {
                    phase: "awaiting-departure",
                    agentName: agent.name,
                    lastObservationKey: this.observationKey(agent),
                    ...(stationaryPosition
                        ? this.stationaryState(stationaryPosition)
                        : {}),
                });
                this.logObservation("encountered", agent, destination, movement, "wait", movement
                    ? "agent-moving-to-next-cell"
                    : "agent-on-next-cell");
            }
        }
    }
    updateBlockers(destination, blockers) {
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
                        agentName: agent.name,
                        lastObservationKey: observationKey,
                    });
                    this.logObservation("observed", agent, destination, movement, "wait", "agent-moving-from-next-cell");
                    continue;
                }
                if (movement?.destination.isEqual(destination)
                    || stationaryPosition?.isEqual(destination)) {
                    blockers.set(agentId, {
                        ...blocker,
                        lastObservationKey: observationKey,
                        ...(stationaryPosition
                            ? this.stationaryState(stationaryPosition, blocker)
                            : {
                                stationarySince: undefined,
                                stationaryPosition: undefined,
                            }),
                    });
                    this.logObservation("observed", agent, destination, movement, "wait", movement
                        ? "agent-moving-to-next-cell"
                        : "agent-on-next-cell");
                    continue;
                }
                if (movement) {
                    blockers.delete(agentId);
                    this.logObservation("cleared", agent, destination, movement, "move", "next-move-is-safe");
                    continue;
                }
                if (stationaryPosition) {
                    if (stationaryPosition.distanceTo(destination) === 1) {
                        blockers.set(agentId, {
                            phase: "awaiting-next-direction",
                            departureDestination: stationaryPosition,
                            agentName: agent.name,
                            lastObservationKey: observationKey,
                            ...this.stationaryState(stationaryPosition),
                        });
                        this.logObservation("observed", agent, destination, movement, "wait", "departure-completed");
                    }
                    else {
                        blockers.delete(agentId);
                        this.logObservation("cleared", agent, destination, movement, "move", "next-move-is-safe");
                    }
                    continue;
                }
                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                });
                this.logObservation("observed", agent, destination, movement, "wait", "movement-uncertain");
                continue;
            }
            if (stationaryPosition?.isEqual(destination)) {
                this.logObservation("replanned", agent, destination, movement, "replan", "agent-oscillating-replan");
                return { decision: "replan", blockedCell: destination };
            }
            if (!movement) {
                if (stationaryPosition
                    && !stationaryPosition.isEqual(blocker.departureDestination)) {
                    blockers.delete(agentId);
                    this.logObservation("cleared", agent, destination, movement, "move", "next-move-is-safe");
                    continue;
                }
                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                    ...(stationaryPosition
                        ? this.stationaryState(stationaryPosition, blocker)
                        : {}),
                });
                this.logObservation("observed", agent, destination, movement, "wait", stationaryPosition?.isEqual(blocker.departureDestination)
                    ? "departure-completed"
                    : "movement-uncertain");
                continue;
            }
            if (movement.destination.isEqual(destination)) {
                this.logObservation("replanned", agent, destination, movement, "replan", "agent-oscillating-replan");
                return { decision: "replan", blockedCell: destination };
            }
            if (movement.source.isEqual(destination)
                && movement.destination.isEqual(blocker.departureDestination)) {
                blockers.set(agentId, {
                    ...blocker,
                    lastObservationKey: observationKey,
                });
                this.logObservation("observed", agent, destination, movement, "wait", "agent-moving-from-next-cell");
                continue;
            }
            blockers.delete(agentId);
            this.logObservation("cleared", agent, destination, movement, "move", "next-move-is-safe");
        }
        return undefined;
    }
    millisecondsUntilReplan(blockers) {
        let earliestDeadline;
        for (const blocker of blockers.values()) {
            if (blocker.stationarySince === undefined) {
                continue;
            }
            const deadline = blocker.stationarySince
                + this.stationaryWaitDuration();
            earliestDeadline = earliestDeadline === undefined
                ? deadline
                : Math.min(earliestDeadline, deadline);
        }
        return earliestDeadline === undefined
            ? undefined
            : Math.max(0, earliestDeadline - Date.now());
    }
    replanForExpiredBlocker(blockers, nextCell) {
        const timeNow = Date.now();
        const waitDuration = this.stationaryWaitDuration();
        for (const [agentId, blocker] of blockers) {
            if (blocker.stationarySince === undefined
                || blocker.stationaryPosition === undefined
                || timeNow - blocker.stationarySince < waitDuration) {
                continue;
            }
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
        return undefined;
    }
    stationaryWaitDuration() {
        return Math.max(1, this.beliefs.frame_duration, ConservativeMovementGuard.STATIONARY_WAIT_TICKS
            * this.beliefs.movement_duration);
    }
    stationaryState(position, previous) {
        const sameStationaryPosition = previous?.stationaryPosition
            ?.isEqual(position) ?? false;
        return {
            stationarySince: sameStationaryPosition
                ? previous.stationarySince ?? Date.now()
                : Date.now(),
            stationaryPosition: position,
        };
    }
    logObservation(event, agent, nextCell, movement, decision, reason) {
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
    observationKey(agent) {
        return `${agent.x},${agent.y}`;
    }
    observedMovement(agent) {
        const xIsInteger = Number.isInteger(agent.x);
        const yIsInteger = Number.isInteger(agent.y);
        if (xIsInteger === yIsInteger) {
            return undefined;
        }
        const destination = new Position(Math.round(agent.x), Math.round(agent.y));
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
    stationaryPosition(agent) {
        if (!Number.isInteger(agent.x) || !Number.isInteger(agent.y)) {
            return undefined;
        }
        return new Position(agent.x, agent.y);
    }
}
ConservativeMovementGuard.STATIONARY_WAIT_TICKS = 2;
//# sourceMappingURL=movement-safety.js.map