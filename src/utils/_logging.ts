import type { IntentionDescription } from "../bdi/intentions.js";
import {
    OPTION_BRANCH_DECISION,
    OPTION_TRAVERSABILITY,
    type OptionEvaluationEdge,
    type OptionEvaluationGraph,
    type OptionEvaluationNode,
    type OptionType,
} from "../bdi/option_evaluator.js";
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
    readonly temporaryWalls: readonly Position[];
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

/** Planner used to validate a selected root option against the real map. */
export type OptionPlanMethod =
    | "already-at-target"
    | "astar"
    | "pddl"
    | "astar-then-pddl";

/** One attempt to turn an evaluator-selected root into executable actions. */
export interface OptionPlanAttemptLog {
    readonly optionIdentity: string;
    readonly optionType: OptionType;
    readonly parcelId: string | undefined;
    readonly targetPosition: Position;
    readonly estimatedTraversability: OPTION_TRAVERSABILITY | undefined;
    readonly result: "planned" | "rejected";
    readonly planner: OptionPlanMethod;
    readonly plannedActions: number;
    readonly reason: "route-found" | "no-executable-route" | "missing-parcel-id";
}

export type OptionSearchOutcome =
    | "planned"
    | "satisfied"
    | "transiently-blocked"
    | "infeasible";

/** Complete explanation of evaluator passes and executable-plan validation. */
export interface BranchAndBoundLog {
    readonly cycle: number;
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
    abstract logDeliberation(deliberation: DeliberationLog): void;
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
    constructor(private readonly isLoggingActive: boolean) {
        super();
    }

    logDeliberation(deliberation: DeliberationLog): void {
        if(!this.isLoggingActive)
            return;

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
            + ` temporary-walls=${beliefs.temporaryWalls.length > 0
                ? beliefs.temporaryWalls.map(
                    (wall: Position): string => `(${wall.x}, ${wall.y})`,
                ).join(",")
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
        if(!this.isLoggingActive)
            return;

        console.log(
            `\nDELIVERY RESULT | actual-points-gained=+${delivery.pointsGained}`
            + ` | total-score=${delivery.totalScore}`,
        );
    }

    override logMovementSafety(movement: MovementSafetyLog): void {
        if(!this.isLoggingActive)
            return;

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
        if(!this.isLoggingActive)
            return;

        console.log(
            `\nMOVE FAILED`
            + ` | destination=(${failure.destination.x}, ${failure.destination.y})`
            + ` | decision=REPLAN`
            + ` | temporary-wall=(${failure.destination.x}, ${failure.destination.y})`,
        );
    }

    override logBranchAndBound(search: BranchAndBoundLog): void {
        if(!this.isLoggingActive)
            return;

        const lines: string[] = [
            "",
            "------------------------------------------------------------",
            `BRANCH-AND-BOUND GRAPH | cycle=${search.cycle}`
            + ` | start=(${search.position.x}, ${search.position.y})`
            + ` | evaluation-passes=${search.evaluationPasses.length}`,
            "TRAVERSABILITY | DIRECT=A* route exists"
            + " | CRATE-PLAN=optimistic crate-relaxed route; PDDL must validate"
            + " | UNREACHABLE=no route even after relaxing crates",
        ];

        search.evaluationPasses.forEach(
            (graph: OptionEvaluationGraph, index: number): void => {
                const excluded = graph.excludedRootOptionIdentities.length > 0
                    ? graph.excludedRootOptionIdentities.join(", ")
                    : "none";
                lines.push(
                    "",
                    `PASS ${index + 1}`
                    + ` | nodes=${graph.nodes.length}`
                    + ` edges=${graph.edges.length}`
                    + ` best-score=${graph.bestScore.toFixed(3)}`
                    + ` completion=${graph.estimatedCompletionMilliseconds}ms`
                    + ` | excluded-roots=${excluded}`,
                );
                this.appendOptionGraph(graph, lines);
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
            "------------------------------------------------------------",
        );
        console.log(lines.join("\n"));
    }

    private appendOptionGraph(
        graph: OptionEvaluationGraph,
        lines: string[],
    ): void {
        const nodesById = new Map<string, OptionEvaluationNode>(
            graph.nodes.map(
                (node: OptionEvaluationNode): [string, OptionEvaluationNode] =>
                    [node.id, node],
            ),
        );
        const edgesBySource = new Map<string, OptionEvaluationEdge[]>();
        for (const edge of graph.edges) {
            const outgoingEdges = edgesBySource.get(edge.sourceNodeId) ?? [];
            outgoingEdges.push(edge);
            edgesBySource.set(edge.sourceNodeId, outgoingEdges);
        }
        for (const outgoingEdges of edgesBySource.values()) {
            outgoingEdges.sort(
                (first: OptionEvaluationEdge, second: OptionEvaluationEdge): number =>
                    first.order - second.order,
            );
        }

        const root = nodesById.get(graph.rootNodeId);
        if (!root) {
            lines.push("  graph root is missing");
            return;
        }
        this.appendOptionNode(root, nodesById, edgesBySource, lines);
    }

    private appendOptionNode(
        node: OptionEvaluationNode,
        nodesById: ReadonlyMap<string, OptionEvaluationNode>,
        edgesBySource: ReadonlyMap<string, readonly OptionEvaluationEdge[]>,
        lines: string[],
    ): void {
        const indent = "  ".repeat(node.depth + 1);
        const carried = node.carriedParcelIds.length > 0
            ? node.carriedParcelIds.join(",")
            : "none";
        const decision = node.selectedOptionIdentity ?? "STOP";
        lines.push(
            `${indent}STATE (${node.position.x}, ${node.position.y})`
            + ` elapsed=${node.elapsedMilliseconds}ms`
            + ` carried=${carried}`
            + ` | best-next=${decision}`,
        );

        const outgoingEdges = edgesBySource.get(node.id) ?? [];
        if (outgoingEdges.length === 0) {
            lines.push(`${indent}  STOP | no actions remain`);
            return;
        }
        if (node.selectedOptionIdentity === undefined) {
            lines.push(
                `${indent}  STOP [SELECTED]`
                + " | no branch improves the zero-score stop option",
            );
        }

        for (const edge of outgoingEdges) {
            const edgeIndent = `${indent}  `;
            const { x, y } = edge.targetPosition;
            const action = edge.optionType === "pick"
                ? `PICK parcel=${edge.parcelId ?? "missing"}`
                : "DROP carried parcels";
            const score = edge.branchScore === undefined
                ? "unknown"
                : edge.branchScore.toFixed(3);
            const marker = edge.decision === OPTION_BRANCH_DECISION.SELECTED
                ? "[BEST FROM THIS STATE]"
                : edge.decision === OPTION_BRANCH_DECISION.UNREACHABLE
                    ? "[REJECTED: UNREACHABLE]"
                    : "[NOT SELECTED: LOWER VALUE OR SLOWER]";
            lines.push(
                `${edgeIndent}-> ${action} at (${x}, ${y}) ${marker}`
                + ` | route=${this.formatTraversability(edge.traversability)}`
                + ` distance=${edge.estimatedDistance ?? "n/a"}`
                + ` arrival=${edge.estimatedArrivalMilliseconds ?? "n/a"}ms`
                + ` immediate-score=${edge.immediateDeliveryScore.toFixed(3)}`
                + ` branch-score=${score}`,
            );

            if (edge.targetNodeId === undefined) {
                continue;
            }
            const targetNode = nodesById.get(edge.targetNodeId);
            if (targetNode) {
                this.appendOptionNode(
                    targetNode,
                    nodesById,
                    edgesBySource,
                    lines,
                );
            }
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
