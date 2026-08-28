import type { IntentionDescription } from "./intentions.js";
import type { Position } from "./position.js";

/** One available intention and its score in the current deliberation. */
export interface IntentionLogEntry {
    readonly description: IntentionDescription;
    readonly score: number;
    readonly distance: number | undefined;
    readonly selected: boolean;
}

/** Belief summary used to explain the state behind a decision. */
export interface BeliefLogSummary {
    readonly knownParcels: number;
    readonly freeParcels: number;
    readonly carriedByAgent: number;
    readonly carriedByOthers: number;
    readonly knownCrates: number;
    readonly temporaryWall: Position | undefined;
}

/** Complete, structured record of one deliberation cycle. */
export interface DeliberationLog {
    readonly cycle: number;
    readonly agentId: string;
    readonly agentScore: number | undefined;
    readonly position: Position;
    readonly beliefs: BeliefLogSummary;
    readonly options: readonly IntentionLogEntry[];
    readonly plannedActions: number;
}

/** Authoritative score increase reported by the server after a delivery. */
export interface DeliveryGainLog {
    readonly pointsGained: number;
    readonly totalScore: number;
}

/** A server-rejected movement that causes immediate replanning. */
export interface MoveFailureLog {
    readonly destination: Position;
}

export type MovementSafetyEvent =
    | "encountered"
    | "observed"
    | "cleared"
    | "replanned";

export type MovementSafetyReason =
    | "agent-on-next-cell"
    | "agent-moving-to-next-cell"
    | "agent-moving-from-next-cell"
    | "departure-completed"
    | "agent-returning-to-next-cell"
    | "agent-left-observation-range"
    | "agent-not-visible"
    | "movement-uncertain"
    | "next-move-is-safe"
    | "agent-stationary-replan"
    | "agent-oscillating-replan";

/** One relevant observation made while avoiding another agent. */
export interface MovementSafetyLog {
    readonly event: MovementSafetyEvent;
    readonly agentId: string;
    readonly agentName: string;
    readonly nextCell: Position;
    readonly observedPosition: Position | undefined;
    readonly movementSource: Position | undefined;
    readonly movementDestination: Position | undefined;
    readonly decision: "wait" | "move" | "replan";
    readonly reason: MovementSafetyReason;
}

/** Output contract for agent decisions. */
export abstract class BaseAgentLogger {
    abstract logDeliberation(deliberation: DeliberationLog): void;
    abstract logDeliveryGain(delivery: DeliveryGainLog): void;

    /** Optional so existing non-console loggers remain source-compatible. */
    logMovementSafety(_movement: MovementSafetyLog): void { }

    /** Optional so existing non-console loggers remain source-compatible. */
    logMoveFailure(_failure: MoveFailureLog): void { }
}

/** Human-readable terminal logger for complete agent decisions. */
export class ConsoleAgentLogger extends BaseAgentLogger {
    logDeliberation(deliberation: DeliberationLog): void {
        const { x, y } = deliberation.position;
        const { beliefs } = deliberation;
        const rankedOptions = [...deliberation.options].sort(
            (first: IntentionLogEntry, second: IntentionLogEntry): number => {
                const scoreDifference = second.score - first.score;
                if (scoreDifference !== 0) {
                    return scoreDifference;
                }
                return (first.distance ?? Number.POSITIVE_INFINITY)
                    - (second.distance ?? Number.POSITIVE_INFINITY);
            },
        );

        console.log("\n============================================================");
        console.log(
            `DELIBERATION ${deliberation.cycle}`
            + ` | agent=${deliberation.agentId || "unknown"}`
            + ` | position=(${x}, ${y})`
            + ` | score=${deliberation.agentScore ?? "unknown"}`,
        );
        console.log(
            `BELIEFS | parcels=${beliefs.knownParcels}`
            + ` free=${beliefs.freeParcels}`
            + ` carried-by-me=${beliefs.carriedByAgent}`
            + ` carried-by-others=${beliefs.carriedByOthers}`
            + ` crates=${beliefs.knownCrates}`
            + ` temporary-wall=${beliefs.temporaryWall
                ? `(${beliefs.temporaryWall.x}, ${beliefs.temporaryWall.y})`
                : "none"}`,
        );
        console.log(`OPTIONS | ${rankedOptions.length} available (highest score first)`);

        rankedOptions.forEach((option: IntentionLogEntry, index: number): void => {
            const marker = option.selected ? ">" : " ";
            const state = option.selected
                ? "SELECTED"
                : option.score < 0
                    ? "NOT VIABLE"
                    : "CANDIDATE";
            console.log(
                `${marker} #${index + 1} [${state}]`
                + ` score=${option.score.toFixed(3)}`
                + ` distance=${option.distance ?? "unknown"}`
                + ` | ${this.formatDescription(option.description)}`,
            );
        });

        const selectedOption = rankedOptions.find(
            (option: IntentionLogEntry): boolean => option.selected,
        );
        console.log(
            `DECISION | ${selectedOption
                ? this.formatDescription(selectedOption.description)
                : "none"}`
            + `${selectedOption ? ` | score=${selectedOption.score.toFixed(3)}` : ""}`
            + ` | planned actions=${deliberation.plannedActions}`,
        );
        console.log("============================================================");
    }

    logDeliveryGain(delivery: DeliveryGainLog): void {
        console.log(
            `\nDELIVERY RESULT | actual-points-gained=+${delivery.pointsGained}`
            + ` | total-score=${delivery.totalScore}`,
        );
    }

    override logMovementSafety(movement: MovementSafetyLog): void {
        const label = movement.event === "encountered"
            ? "AGENT ENCOUNTER"
            : movement.event === "cleared"
                ? "AGENT CLEAR"
                : movement.event === "replanned"
                    ? "AGENT REPLAN"
                    : "AGENT MOVEMENT";
        const observedPosition = movement.observedPosition
            ? `(${movement.observedPosition.x}, ${movement.observedPosition.y})`
            : "not-visible";
        const trajectory = movement.movementSource
            && movement.movementDestination
            ? `(${movement.movementSource.x}, ${movement.movementSource.y})`
                + `->(${movement.movementDestination.x}, ${movement.movementDestination.y})`
            : "stationary-or-unknown";

        console.log(
            `\n${label}`
            + ` | agent=${movement.agentName}(${movement.agentId})`
            + ` | observed=${observedPosition}`
            + ` | move=${trajectory}`
            + ` | our-next=(${movement.nextCell.x}, ${movement.nextCell.y})`
            + ` | decision=${movement.decision.toUpperCase()}`
            + ` | reason=${movement.reason}`,
        );
    }

    override logMoveFailure(failure: MoveFailureLog): void {
        console.log(
            `\nMOVE FAILED`
            + ` | destination=(${failure.destination.x}, ${failure.destination.y})`
            + ` | decision=REPLAN`
            + ` | temporary-wall=(${failure.destination.x}, ${failure.destination.y})`,
        );
    }

    private formatDescription(description: IntentionDescription): string {
        switch (description.type) {
            case "search":
                return description.target
                    ? `SEARCH target=(${description.target.x}, ${description.target.y})`
                    : "SEARCH target=chosen only if selected";
            case "pick-up":
                return `PICK-UP parcel=${description.parcelId}`
                    + ` target=(${description.target.x}, ${description.target.y})`
                    + ` current-reward=${description.reward}`;
            case "deliver":
                return `DELIVER target=(${description.target.x}, ${description.target.y})`
                    + ` parcels=${description.parcelCount}`
                    + ` estimated-delivery-gain=${description.estimatedGain.toFixed(3)}`;
        }
    }
}
