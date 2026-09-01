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
import type { PlanningObjectiveDescription } from "./planning.js";
import type { Position } from "./position.js";
import {
    BaseBranchAndBoundGraphWriter,
    BranchAndBoundSvgWriter,
} from "./_branch-and-bound-svg.js";

/** ANSI presentation used only when stdout is attached to a color terminal. */
class TerminalTheme {
    private static readonly RESET = "\u001B[0m";
    private static readonly BOLD = "\u001B[1m";
    private static readonly DIM = "\u001B[2m";
    private static readonly RED = "\u001B[31m";
    private static readonly GREEN = "\u001B[32m";
    private static readonly YELLOW = "\u001B[33m";
    private static readonly BLUE = "\u001B[34m";
    private static readonly CYAN = "\u001B[36m";

    private readonly enabled: boolean = process.stdout.isTTY
        && process.env.NO_COLOR === undefined;

    heading(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.CYAN]);
    }

    label(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.BLUE]);
    }

    success(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.GREEN]);
    }

    warning(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.YELLOW]);
    }

    error(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.RED]);
    }

    muted(value: string): string {
        return this.decorate(value, [TerminalTheme.DIM]);
    }

    private decorate(value: string, codes: readonly string[]): string {
        if (!this.enabled) {
            return value;
        }
        return `${codes.join("")}${value}${TerminalTheme.RESET}`;
    }
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
    /** First route-validated objective whose actions are queued for execution. */
    readonly nextExecutableObjective: PlanningObjectiveDescription;
}

/** Lifecycle state of one executable segment within a chosen objective sequence. */
export enum PLAN_SEGMENT_EVENT {
    STARTED = "started",
    COMPLETED = "completed",
    INTERRUPTED = "interrupted",
}

interface PlanSegmentLogBase {
    readonly cycle: number;
    readonly objective: PlanningObjectiveDescription;
    readonly remainingActions: number;
}

/** Execution update emitted separately from planning-cycle output. */
export type PlanSegmentLog = PlanSegmentLogBase & (
    | {
        readonly event:
            | PLAN_SEGMENT_EVENT.STARTED
            | PLAN_SEGMENT_EVENT.COMPLETED;
        readonly interruptionReason?: never;
    }
    | {
        readonly event: PLAN_SEGMENT_EVENT.INTERRUPTED;
        readonly interruptionReason: DELIBERATION_CYCLE_REASON;
    }
);

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
    | "movement-uncertain-replan"
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

    /** Optional so existing non-console loggers remain source-compatible. */
    logPlanSegment(_segment: PlanSegmentLog): void { }
}

/** Human-readable terminal logger for complete agent decisions. */
export class ConsoleAgentLogger extends BaseAgentLogger {
    private readonly theme: TerminalTheme = new TerminalTheme();

    constructor(
        private readonly branchAndBoundGraphWriter:
            BaseBranchAndBoundGraphWriter = new BranchAndBoundSvgWriter(),
    ) {
        super();
    }

    logDeliveryGain(delivery: DeliveryGainLog): void {
        console.log(
            `\n${this.theme.success("◆ DELIVERY")}`
            + `  ${this.theme.success(`+${delivery.pointsGained} points`)}`
            + `  ${this.theme.muted("·")}`
            + `  total ${delivery.totalScore}`,
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
        const successfulAttempt = search.planningAttempts.find(
            (attempt: OptionPlanAttemptLog): boolean =>
                attempt.result === "planned",
        );
        const graphPaths = this.branchAndBoundGraphWriter.outputPaths(
            search.agentId,
            search.cycle,
            search.evaluationPasses.length,
        );
        const lines: string[] = [
            "",
            "",
            this.theme.heading(`╭─ PLANNING CYCLE ${search.cycle}`),
            this.formatDetail(
                "TRIGGER",
                this.formatCycleReason(search.cycleReason),
            ),
            this.formatDetail(
                "START POSITION",
                `(${search.position.x}, ${search.position.y})`,
            ),
        ];
        if (search.beliefChanges.length > 0) {
            lines.push(this.formatSection("BELIEF CHANGES"));
            for (const change of search.beliefChanges) {
                lines.push(
                    `│  ${this.theme.warning("•")}`
                    + ` ${this.formatBeliefChange(change, search.agentId)}`,
                );
            }
        }
        lines.push(this.formatSection("CANDIDATE EVALUATION"));

        search.evaluationPasses.forEach(
            (graph: OptionEvaluationGraph, index: number): void => {
                const excluded = graph.excludedRootOptionIdentities.length > 0
                    ? graph.excludedRootOptionIdentities.join(", ")
                    : "none";
                lines.push(
                    "│",
                    `│  ${this.theme.label(`PASS ${index + 1}`)}`
                    + `  ${this.formatCount(graph.nodes.length, "state")}`
                    + ` ${this.theme.muted("·")}`
                    + ` ${this.formatCount(graph.edges.length, "transition")}`,
                    this.formatDetail(
                        "CHOSEN SEQUENCE",
                        this.formatSelectedSequence(graph),
                        4,
                    ),
                    this.formatDetail(
                        "EXPECTED REWARD",
                        graph.bestScore.toFixed(3),
                        4,
                    ),
                    this.formatDetail(
                        "COMPLETION TIME",
                        `${graph.estimatedCompletionMilliseconds}ms`,
                        4,
                    ),
                    this.formatDetail("PREVIOUSLY REJECTED", excluded, 4),
                );
            },
        );

        const rejectedAttempts = search.planningAttempts.filter(
            (attempt: OptionPlanAttemptLog): boolean =>
                attempt.result === "rejected",
        );
        if (rejectedAttempts.length > 0) {
            lines.push(this.formatSection("REJECTED ROUTE ATTEMPTS"));
            rejectedAttempts.forEach(
                (attempt: OptionPlanAttemptLog, index: number): void => {
                    const { x, y } = attempt.targetPosition;
                    lines.push(
                        `│  ${this.theme.error(`✗ #${index + 1}`)}`
                        + ` ${attempt.optionIdentity}`
                        + ` at (${x}, ${y})`
                        + ` ${this.theme.muted("·")}`
                        + ` estimate ${this.formatTraversability(
                            attempt.estimatedTraversability,
                        )}`
                        + ` ${this.theme.muted("·")}`
                        + ` ${this.formatPlanMethod(attempt.planner)}`
                        + ` ${this.theme.muted("·")}`
                        + ` ${attempt.reason}`,
                    );
                },
            );
        }

        lines.push(this.formatSection("NEXT EXECUTABLE OBJECTIVE"));
        lines.push(
            this.formatDetail(
                "OBJECTIVE",
                this.theme.success(
                    this.formatObjective(search.nextExecutableObjective),
                ),
            ),
            this.formatDetail(
                "ROLE",
                successfulAttempt
                    ? "first objective in the chosen sequence"
                    : search.planSource === "search"
                        ? "exploration fallback"
                        : "no executable objective",
            ),
            this.formatDetail("PATHFINDER", successfulAttempt
                ? this.formatPlanMethod(successfulAttempt.planner)
                : search.planSource === "search"
                    ? "EXPLORATION FALLBACK"
                    : "NONE"),
            this.formatDetail(
                "STATUS",
                this.formatColoredPlanStatus(search.outcome),
            ),
            this.formatDetail("QUEUED ACTIONS", `${search.plannedActions}`),
        );
        if (successfulAttempt) {
            const { x, y } = successfulAttempt.targetPosition;
            lines.push(
                this.formatDetail(
                    "ROUTE CHECK",
                    `target (${x}, ${y})`
                    + ` ${this.theme.muted("·")}`
                    + ` ${this.formatTraversability(
                        successfulAttempt.estimatedTraversability,
                    )}`,
                ),
            );
        }

        lines.push(this.formatSection("DECISION GRAPH"));
        graphPaths.forEach((path: string): void => {
            lines.push(this.formatDetail("FILE", path));
        });
        lines.push(this.theme.heading(
            "╰───────────────────────────────────────────────────────────────────────────────",
        ));
        console.log(lines.join("\n"));
        void this.branchAndBoundGraphWriter.writeGraphs(
            search.agentId,
            search.cycle,
            search.evaluationPasses,
        ).catch((error: unknown): void => {
            console.error("Could not write branch-and-bound SVG:", error);
        });
    }

    override logPlanSegment(segment: PlanSegmentLog): void {
        const objective = this.formatObjective(segment.objective);
        switch (segment.event) {
            case PLAN_SEGMENT_EVENT.STARTED:
                console.log(
                    `\n${this.theme.label("▶ EXECUTING")}`
                    + `  ${this.theme.success(objective)}`
                    + `  ${this.theme.muted("·")}`
                    + ` ${segment.remainingActions} queued actions`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`,
                );
                break;
            case PLAN_SEGMENT_EVENT.COMPLETED:
                console.log(
                    `\n${this.theme.success("✓ OBJECTIVE COMPLETED")}`
                    + `  ${objective}`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`,
                );
                break;
            case PLAN_SEGMENT_EVENT.INTERRUPTED:
                console.log(
                    `\n${this.theme.warning("⚠ OBJECTIVE INTERRUPTED")}`
                    + `  ${objective}`
                    + `  ${this.theme.muted("·")}`
                    + ` ${segment.remainingActions} actions left`
                    + `  ${this.theme.muted("·")}`
                    + ` ${this.formatCycleReason(
                        segment.interruptionReason,
                    )}`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`,
                );
                break;
        }
    }

    private formatSection(title: string): string {
        return this.theme.heading(`├─ ${title}`);
    }

    private formatCount(count: number, noun: string): string {
        return `${count} ${noun}${count === 1 ? "" : "s"}`;
    }

    private formatDetail(
        label: string,
        value: string,
        indentation: number = 2,
    ): string {
        const prefix = `│${" ".repeat(indentation)}`;
        return `${prefix}${this.theme.muted(label.padEnd(21))}${value}`;
    }

    private formatColoredPlanStatus(outcome: OptionSearchOutcome): string {
        const status = this.formatPlanStatus(outcome);
        switch (outcome) {
            case "planned":
            case "satisfied":
                return this.theme.success(status);
            case "transiently-blocked":
                return this.theme.warning(status);
            case "infeasible":
                return this.theme.error(status);
        }
    }

    private formatCycleReason(reason: DELIBERATION_CYCLE_REASON): string {
        switch (reason) {
            case DELIBERATION_CYCLE_REASON.AGENT_STARTED:
                return "Agent started";
            case DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED:
                return "Beliefs changed";
            case DELIBERATION_CYCLE_REASON.MOVEMENT_SAFETY_REPLAN:
                return "Movement safety required replanning";
            case DELIBERATION_CYCLE_REASON.ACTION_FAILED:
                return "An action failed";
            case DELIBERATION_CYCLE_REASON.OPTION_SEGMENT_COMPLETED:
                return "The previous objective segment completed";
            case DELIBERATION_CYCLE_REASON.PLAN_COMPLETED:
                return "The previous plan completed";
            case DELIBERATION_CYCLE_REASON.TRANSIENT_BLOCKAGE_RETRY:
                return "Retrying after a temporary blockage";
        }
    }

    private formatPlanStatus(outcome: OptionSearchOutcome): string {
        switch (outcome) {
            case "planned":
                return "EXECUTABLE";
            case "satisfied":
                return "ALREADY SATISFIED";
            case "transiently-blocked":
                return "WAITING FOR TEMPORARY BLOCKAGE";
            case "infeasible":
                return "NO EXECUTABLE PLAN";
        }
    }

    private formatPlanMethod(method: OptionPlanMethod): string {
        switch (method) {
            case "already-at-target":
                return "ALREADY AT TARGET";
            case "astar":
                return "A*";
            case "pddl":
                return "PDDL";
            case "astar-then-pddl":
                return "A*, THEN PDDL";
        }
    }

    private formatObjective(objective: PlanningObjectiveDescription): string {
        switch (objective.type) {
            case "pick-up":
                return `PICK ${objective.parcelId} at `
                    + `(${objective.target.x}, ${objective.target.y})`;
            case "deliver":
                return `DROP at (${objective.target.x}, ${objective.target.y})`;
            case "search":
                return objective.target
                    ? `EXPLORE pickup cells toward `
                        + `(${objective.target.x}, ${objective.target.y})`
                    : "EXPLORE pickup cells";
        }
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
