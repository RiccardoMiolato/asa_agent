import {
    BELIEF_CHANGE_TYPE,
    type BeliefChange,
} from "./beliefs.js";
import {
    OPTION_TRAVERSABILITY,
    type OptionEvaluationGraph,
    type OptionEvaluationNode,
} from "./option_evaluator.js";
import type { DESIRE_TYPE } from "./desires.js";
import type { Position } from "./position.js";
import {
    BaseBranchAndBoundGraphWriter,
    BranchAndBoundSvgWriter,
} from "./_branch-and-bound-svg.js";

/** Authoritative score increase reported by the server after a delivery. */
export interface DeliveryGainLog {
    readonly pointsGained: number;
    readonly totalScore: number;
}

/** A server-rejected movement that causes immediate replanning. */
export interface MoveFailureLog {
    readonly destination: Position;
}

/** Planner used to validate a selected root option against the real map. */
export type OptionPlanMethod =
    | "already-at-target"
    | "astar"
    | "pddl"
    | "astar-then-pddl";

/** One attempt to turn an evaluator-selected root into executable actions. */
export interface OptionPlanAttemptLog {
    readonly optionIdentity: string;
    readonly optionType: DESIRE_TYPE;
    readonly parcelId: string | undefined;
    readonly targetPosition: Position;
    readonly estimatedTraversability: OPTION_TRAVERSABILITY | undefined;
    readonly result: "planned" | "rejected";
    readonly planner: OptionPlanMethod;
    readonly plannedActions: number;
    readonly reason: "route-found" | "no-executable-route";
}

export type OptionSearchOutcome =
    | "planned"
    | "satisfied"
    | "transiently-blocked"
    | "infeasible";

/** Event that caused the agent to begin a new deliberation cycle. */
export enum DELIBERATION_CYCLE_REASON {
    AGENT_STARTED = "agent-started",
    BELIEFS_CHANGED = "beliefs-changed",
    MOVEMENT_SAFETY_REPLAN = "movement-safety-replan",
    ACTION_FAILED = "action-failed",
    OPTION_SEGMENT_COMPLETED = "option-segment-completed",
    PLAN_COMPLETED = "plan-completed",
    TRANSIENT_BLOCKAGE_RETRY = "transient-blockage-retry",
}

/** Complete explanation of evaluator passes and executable-plan validation. */
export interface BranchAndBoundLog {
    readonly cycle: number;
    readonly cycleReason: DELIBERATION_CYCLE_REASON;
    readonly beliefChanges: readonly BeliefChange[];
    readonly agentId: string;
    readonly position: Position;
    readonly evaluationPasses: readonly OptionEvaluationGraph[];
    readonly planningAttempts: readonly OptionPlanAttemptLog[];
    readonly outcome: OptionSearchOutcome;
    readonly planSource: "option" | "search" | "none";
    readonly plannedActions: number;
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
    abstract logDeliveryGain(delivery: DeliveryGainLog): void;

    /** Optional so existing non-console loggers remain source-compatible. */
    logMovementSafety(_movement: MovementSafetyLog): void { }

    /** Optional so existing non-console loggers remain source-compatible. */
    logMoveFailure(_failure: MoveFailureLog): void { }

    /** Optional so existing non-console loggers remain source-compatible. */
    logBranchAndBound(_search: BranchAndBoundLog): void { }
}

/** Human-readable terminal logger for complete agent decisions. */
export class ConsoleAgentLogger extends BaseAgentLogger {
    constructor(
        private readonly branchAndBoundGraphWriter:
            BaseBranchAndBoundGraphWriter = new BranchAndBoundSvgWriter(),
    ) {
        super();
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

    override logBranchAndBound(search: BranchAndBoundLog): void {
        const lines: string[] = [
            "",
            "",
            "================================================================================",
            `TURN ${search.cycle} | BRANCH-AND-BOUND`,
            "================================================================================",
            `START REASON | ${search.cycleReason.replace(/-/g, " ").toUpperCase()}`,
            `STATE | start=(${search.position.x}, ${search.position.y})`
            + ` | evaluation-passes=${search.evaluationPasses.length}`,
        ];
        if (search.beliefChanges.length > 0) {
            lines.push("BELIEF CHANGES");
            for (const change of search.beliefChanges) {
                lines.push(
                    `  - ${this.formatBeliefChange(change, search.agentId)}`,
                );
            }
        }
        lines.push(
            "--------------------------------------------------------------------------------",
            "SEARCH",
        );

        search.evaluationPasses.forEach(
            (graph: OptionEvaluationGraph, index: number): void => {
                const excluded = graph.excludedRootOptionIdentities.length > 0
                    ? graph.excludedRootOptionIdentities.join(", ")
                    : "none";
                lines.push(
                    "",
                    `PASS ${index + 1}`
                    + ` | nodes=${graph.nodes.length}`
                    + ` | edges=${graph.edges.length}`,
                    `  BEST | score=${graph.bestScore.toFixed(3)}`
                    + ` | completion=${graph.estimatedCompletionMilliseconds}ms`,
                    `  ROUTE | ${this.formatSelectedSequence(graph)}`,
                    `  EXCLUDED ROOTS | ${excluded}`,
                );
            },
        );

        lines.push("", "EXECUTABLE PLAN VALIDATION");
        if (search.planningAttempts.length === 0) {
            lines.push("  no option root was selected for executable validation");
        }
        search.planningAttempts.forEach(
            (attempt: OptionPlanAttemptLog, index: number): void => {
                const { x, y } = attempt.targetPosition;
                lines.push(
                    `  #${index + 1} ${attempt.optionIdentity}`
                    + ` target=(${x}, ${y})`
                    + ` estimate=${this.formatTraversability(
                        attempt.estimatedTraversability,
                    )}`
                    + ` | ${attempt.result.toUpperCase()}`
                    + ` planner=${attempt.planner.toUpperCase()}`
                    + ` actions=${attempt.plannedActions}`
                    + ` reason=${attempt.reason}`,
                );
            },
        );
        if (search.planSource === "search") {
            lines.push("  FALLBACK | parcel options exhausted; SEARCH plan selected");
        }
        lines.push(
            `RESULT | ${search.outcome.toUpperCase()}`
            + ` | source=${search.planSource.toUpperCase()}`
            + ` | executable-actions=${search.plannedActions}`,
            "SVG | generating one zoomable tree per evaluation pass...",
            "--------------------------------------------------------------------------------",
            `END TURN ${search.cycle}`,
            "================================================================================",
            "",
        );
        console.log(lines.join("\n"));
        void this.branchAndBoundGraphWriter.writeGraphs(
            search.agentId,
            search.cycle,
            search.evaluationPasses,
        ).then((paths: readonly string[]): void => {
            console.log(
                `\nARTIFACT READY | turn=${search.cycle}`
                + ` | branch-and-bound-svg=${paths.join(" | ")}\n`,
            );
        }).catch((error: unknown): void => {
            console.error("Could not write branch-and-bound SVG:", error);
        });
    }

    private formatSelectedSequence(graph: OptionEvaluationGraph): string {
        const nodesById = new Map<string, OptionEvaluationNode>(
            graph.nodes.map(
                (node: OptionEvaluationNode): [string, OptionEvaluationNode] =>
                    [node.id, node],
            ),
        );
        const actions: string[] = [];
        let currentNode = nodesById.get(graph.rootNodeId);
        while (currentNode?.selectedOptionIdentity) {
            const selectedEdge = graph.edges.find(
                (edge): boolean => edge.sourceNodeId === currentNode!.id
                    && edge.optionIdentity === currentNode!.selectedOptionIdentity,
            );
            if (!selectedEdge) {
                break;
            }
            actions.push(selectedEdge.optionType === "pick"
                ? `PICK ${selectedEdge.parcelId ?? "missing"}`
                : `DROP (${selectedEdge.targetPosition.x},${selectedEdge.targetPosition.y})`);
            currentNode = selectedEdge.targetNodeId
                ? nodesById.get(selectedEdge.targetNodeId)
                : undefined;
        }
        return actions.length > 0 ? actions.join(" -> ") : "STOP";
    }

    private formatBeliefChange(
        change: BeliefChange,
        ownAgentId: string,
    ): string {
        switch (change.type) {
            case BELIEF_CHANGE_TYPE.PARCEL_DISCOVERED:
                return `parcel ${change.parcelId} discovered`;
            case BELIEF_CHANGE_TYPE.PARCEL_REWARD_CHANGED:
                return `parcel ${change.parcelId} reward: `
                    + `${change.previousReward} -> ${change.currentReward}`;
            case BELIEF_CHANGE_TYPE.PARCEL_CARRIER_CHANGED:
                return `parcel ${change.parcelId} carrier: `
                    + `${change.previousCarrier ?? "free"} -> `
                    + `${change.currentCarrier ?? "free"}`
                    + `${change.currentCarrier === ownAgentId ? " (self)" : ""}`;
            case BELIEF_CHANGE_TYPE.PARCEL_MOVED:
                return `parcel ${change.parcelId} moved: `
                    + `(${change.previousPosition.x}, ${change.previousPosition.y}) -> `
                    + `(${change.currentPosition.x}, ${change.currentPosition.y})`;
            case BELIEF_CHANGE_TYPE.PARCEL_DISAPPEARED:
                return `parcel ${change.parcelId} disappeared`;
            case BELIEF_CHANGE_TYPE.CRATE_DISCOVERED:
                return `crate ${change.crateId} discovered at `
                    + `(${change.position.x}, ${change.position.y})`;
            case BELIEF_CHANGE_TYPE.CRATE_MOVED:
                return `crate ${change.crateId} moved to `
                    + `(${change.position.x}, ${change.position.y})`;
        }
    }

    private formatTraversability(
        traversability: OPTION_TRAVERSABILITY | undefined,
    ): string {
        switch (traversability) {
            case OPTION_TRAVERSABILITY.DIRECT:
                return "DIRECT";
            case OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING:
                return "CRATE-PLAN";
            case OPTION_TRAVERSABILITY.UNREACHABLE:
                return "UNREACHABLE";
            case undefined:
                return "UNKNOWN";
        }
    }

}
