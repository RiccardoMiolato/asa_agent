import { BELIEF_CHANGE_TYPE, } from "./beliefs.js";
import { OPTION_TRAVERSABILITY, } from "./option_evaluator.js";
import { BranchAndBoundSvgWriter, } from "./_branch-and-bound-svg.js";
/** ANSI presentation used only when stdout is attached to a color terminal. */
class TerminalTheme {
    constructor() {
        this.enabled = process.stdout.isTTY
            && process.env.NO_COLOR === undefined;
    }
    heading(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.CYAN]);
    }
    label(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.BLUE]);
    }
    success(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.GREEN]);
    }
    warning(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.YELLOW]);
    }
    error(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.RED]);
    }
    muted(value) {
        return this.decorate(value, [TerminalTheme.DIM]);
    }
    decorate(value, codes) {
        if (!this.enabled) {
            return value;
        }
        return `${codes.join("")}${value}${TerminalTheme.RESET}`;
    }
}
TerminalTheme.RESET = "\u001B[0m";
TerminalTheme.BOLD = "\u001B[1m";
TerminalTheme.DIM = "\u001B[2m";
TerminalTheme.RED = "\u001B[31m";
TerminalTheme.GREEN = "\u001B[32m";
TerminalTheme.YELLOW = "\u001B[33m";
TerminalTheme.BLUE = "\u001B[34m";
TerminalTheme.CYAN = "\u001B[36m";
/** Event that caused the agent to begin a new deliberation cycle. */
export var DELIBERATION_CYCLE_REASON;
(function (DELIBERATION_CYCLE_REASON) {
    DELIBERATION_CYCLE_REASON["AGENT_STARTED"] = "agent-started";
    DELIBERATION_CYCLE_REASON["BELIEFS_CHANGED"] = "beliefs-changed";
    DELIBERATION_CYCLE_REASON["ACTION_FAILED"] = "action-failed";
    DELIBERATION_CYCLE_REASON["OPTION_SEGMENT_COMPLETED"] = "option-segment-completed";
    DELIBERATION_CYCLE_REASON["PLAN_COMPLETED"] = "plan-completed";
    DELIBERATION_CYCLE_REASON["TRANSIENT_BLOCKAGE_RETRY"] = "transient-blockage-retry";
})(DELIBERATION_CYCLE_REASON || (DELIBERATION_CYCLE_REASON = {}));
/** Lifecycle state of one executable segment within a chosen objective sequence. */
export var PLAN_SEGMENT_EVENT;
(function (PLAN_SEGMENT_EVENT) {
    PLAN_SEGMENT_EVENT["STARTED"] = "started";
    PLAN_SEGMENT_EVENT["COMPLETED"] = "completed";
    PLAN_SEGMENT_EVENT["INTERRUPTED"] = "interrupted";
})(PLAN_SEGMENT_EVENT || (PLAN_SEGMENT_EVENT = {}));
/** Output contract for agent decisions. */
export class BaseAgentLogger {
    /** Optional so existing non-console loggers remain source-compatible. */
    logMoveFailure(_failure) { }
    /** Optional so existing non-console loggers remain source-compatible. */
    logBranchAndBound(_search) { }
    /** Optional so existing non-console loggers remain source-compatible. */
    logPlanSegment(_segment) { }
}
/** Human-readable terminal logger for complete agent decisions. */
export class ConsoleAgentLogger extends BaseAgentLogger {
    constructor(options = {}) {
        super();
        this.theme = new TerminalTheme();
        this.branchAndBoundGraphWriter = options.branchAndBoundSvgEnabled
            ? options.branchAndBoundGraphWriter
                ?? new BranchAndBoundSvgWriter()
            : undefined;
    }
    logDeliveryGain(delivery) {
        console.log(`\n${this.theme.success("◆ DELIVERY")}`
            + `  ${this.theme.success(`+${delivery.pointsGained} points`)}`
            + `  ${this.theme.muted("·")}`
            + `  total ${delivery.totalScore}`);
    }
    logMoveFailure(failure) {
        console.log(`\nMOVE FAILED`
            + ` | destination=(${failure.destination.x}, ${failure.destination.y})`
            + ` | decision=REPLAN`
            + ` | temporary-wall=(${failure.destination.x}, ${failure.destination.y})`);
    }
    logBranchAndBound(search) {
        const successfulAttempt = search.planningAttempts.find((attempt) => attempt.result === "planned");
        const graphWriter = this.branchAndBoundGraphWriter;
        const graphPaths = graphWriter?.outputPaths(search.agentId, search.cycle, search.evaluationPasses.length) ?? [];
        const lines = [
            "",
            "",
            this.theme.heading(`╭─ PLANNING CYCLE ${search.cycle}`),
            this.formatDetail("TRIGGER", this.formatCycleReason(search.cycleReason)),
            this.formatDetail("START POSITION", `(${search.position.x}, ${search.position.y})`),
        ];
        if (search.beliefChanges.length > 0) {
            lines.push(this.formatSection("BELIEF CHANGES"));
            for (const change of search.beliefChanges) {
                lines.push(`│  ${this.theme.warning("•")}`
                    + ` ${this.formatBeliefChange(change, search.agentId)}`);
            }
        }
        lines.push(this.formatSection("CANDIDATE EVALUATION"));
        search.evaluationPasses.forEach((graph, index) => {
            const excluded = graph.excludedRootOptionIdentities.length > 0
                ? graph.excludedRootOptionIdentities.join(", ")
                : "none";
            lines.push("│", `│  ${this.theme.label(`PASS ${index + 1}`)}`
                + `  ${this.formatCount(graph.nodes.length, "state")}`
                + ` ${this.theme.muted("·")}`
                + ` ${this.formatCount(graph.edges.length, "transition")}`, this.formatDetail("CHOSEN SEQUENCE", this.formatSelectedSequence(graph), 4), this.formatDetail("EXPECTED REWARD", graph.bestScore.toFixed(3), 4), this.formatDetail("COMPLETION TIME", `${graph.estimatedCompletionMilliseconds}ms`, 4), this.formatDetail("PREVIOUSLY REJECTED", excluded, 4));
        });
        const rejectedAttempts = search.planningAttempts.filter((attempt) => attempt.result === "rejected");
        if (rejectedAttempts.length > 0) {
            lines.push(this.formatSection("REJECTED ROUTE ATTEMPTS"));
            rejectedAttempts.forEach((attempt, index) => {
                const { x, y } = attempt.targetPosition;
                lines.push(`│  ${this.theme.error(`✗ #${index + 1}`)}`
                    + ` ${attempt.optionIdentity}`
                    + ` at (${x}, ${y})`
                    + ` ${this.theme.muted("·")}`
                    + ` estimate ${this.formatTraversability(attempt.estimatedTraversability)}`
                    + ` ${this.theme.muted("·")}`
                    + ` ${this.formatPlanMethod(attempt.planner)}`
                    + ` ${this.theme.muted("·")}`
                    + ` ${attempt.reason}`);
            });
        }
        lines.push(this.formatSection("NEXT EXECUTABLE OBJECTIVE"));
        lines.push(this.formatDetail("OBJECTIVE", this.theme.success(this.formatObjective(search.nextExecutableObjective))), this.formatDetail("ROLE", successfulAttempt
            ? "first objective in the chosen sequence"
            : search.planSource === "search"
                ? "exploration fallback"
                : "no executable objective"), this.formatDetail("PATHFINDER", successfulAttempt
            ? this.formatPlanMethod(successfulAttempt.planner)
            : search.planSource === "search"
                ? "EXPLORATION FALLBACK"
                : "NONE"), this.formatDetail("STATUS", this.formatColoredPlanStatus(search.outcome)), this.formatDetail("QUEUED ACTIONS", `${search.plannedActions}`));
        if (successfulAttempt) {
            const { x, y } = successfulAttempt.targetPosition;
            lines.push(this.formatDetail("ROUTE CHECK", `target (${x}, ${y})`
                + ` ${this.theme.muted("·")}`
                + ` ${this.formatTraversability(successfulAttempt.estimatedTraversability)}`));
        }
        if (graphWriter) {
            lines.push(this.formatSection("DECISION GRAPH"));
            graphPaths.forEach((path) => {
                lines.push(this.formatDetail("FILE", path));
            });
        }
        lines.push(this.theme.heading("╰───────────────────────────────────────────────────────────────────────────────"));
        console.log(lines.join("\n"));
        if (!graphWriter) {
            return;
        }
        void graphWriter.writeGraphs(search.agentId, search.cycle, search.evaluationPasses).catch((error) => {
            console.error("Could not write branch-and-bound SVG:", error);
        });
    }
    logPlanSegment(segment) {
        const objective = this.formatObjective(segment.objective);
        switch (segment.event) {
            case PLAN_SEGMENT_EVENT.STARTED:
                console.log(`\n${this.theme.label("▶ EXECUTING")}`
                    + `  ${this.theme.success(objective)}`
                    + `  ${this.theme.muted("·")}`
                    + ` ${segment.remainingActions} queued actions`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`);
                break;
            case PLAN_SEGMENT_EVENT.COMPLETED:
                console.log(`\n${this.theme.success("✓ OBJECTIVE COMPLETED")}`
                    + `  ${objective}`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`);
                break;
            case PLAN_SEGMENT_EVENT.INTERRUPTED:
                console.log(`\n${this.theme.warning("⚠ OBJECTIVE INTERRUPTED")}`
                    + `  ${objective}`
                    + `  ${this.theme.muted("·")}`
                    + ` ${segment.remainingActions} actions left`
                    + `  ${this.theme.muted("·")}`
                    + ` ${this.formatCycleReason(segment.interruptionReason)}`
                    + `  ${this.theme.muted("·")}`
                    + ` cycle ${segment.cycle}`);
                break;
        }
    }
    formatSection(title) {
        return this.theme.heading(`├─ ${title}`);
    }
    formatCount(count, noun) {
        return `${count} ${noun}${count === 1 ? "" : "s"}`;
    }
    formatDetail(label, value, indentation = 2) {
        const prefix = `│${" ".repeat(indentation)}`;
        return `${prefix}${this.theme.muted(label.padEnd(21))}${value}`;
    }
    formatColoredPlanStatus(outcome) {
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
    formatCycleReason(reason) {
        switch (reason) {
            case DELIBERATION_CYCLE_REASON.AGENT_STARTED:
                return "Agent started";
            case DELIBERATION_CYCLE_REASON.BELIEFS_CHANGED:
                return "Beliefs changed";
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
    formatPlanStatus(outcome) {
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
    formatPlanMethod(method) {
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
    formatObjective(objective) {
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
    formatSelectedSequence(graph) {
        const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
        const actions = [];
        let currentNode = nodesById.get(graph.rootNodeId);
        while (currentNode?.selectedOptionIdentity) {
            const selectedEdge = graph.edges.find((edge) => edge.sourceNodeId === currentNode.id
                && edge.optionIdentity === currentNode.selectedOptionIdentity);
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
    formatBeliefChange(change, ownAgentId) {
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
            case BELIEF_CHANGE_TYPE.PARCEL_EXPIRED:
                return `parcel ${change.parcelId} expired`;
            case BELIEF_CHANGE_TYPE.CRATE_DISCOVERED:
                return `crate ${change.crateId} discovered at `
                    + `(${change.position.x}, ${change.position.y})`;
            case BELIEF_CHANGE_TYPE.CRATE_MOVED:
                return `crate ${change.crateId} moved to `
                    + `(${change.position.x}, ${change.position.y})`;
        }
    }
    formatTraversability(traversability) {
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
//# sourceMappingURL=_logging.js.map