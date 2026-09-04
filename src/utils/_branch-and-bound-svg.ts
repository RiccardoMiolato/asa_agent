import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    OPTION_BRANCH_DECISION,
    OPTION_TRAVERSABILITY,
    type OptionEvaluationEdge,
    type OptionEvaluationGraph,
    type OptionEvaluationNode,
} from "../bdi/option_evaluator.js";

export interface BranchAndBoundSvgContext {
    readonly agentId: string;
    readonly cycle: number;
    readonly pass: number;
}

interface SvgTreeVertex {
    readonly id: string;
    readonly depth: number;
    readonly node: OptionEvaluationNode | undefined;
    readonly incomingEdge: OptionEvaluationEdge | undefined;
    readonly children: SvgTreeVertex[];
    parent: SvgTreeVertex | undefined;
    x: number;
    y: number;
}

interface SvgDimensions {
    readonly width: number;
    readonly height: number;
}

/** Contract for persisting vector representations of option-search graphs. */
export abstract class BaseBranchAndBoundGraphWriter {
    /** Returns the graph destinations before asynchronous rendering starts. */
    abstract outputPaths(
        agentId: string,
        cycle: number,
        graphCount: number,
    ): readonly string[];

    abstract writeGraphs(
        agentId: string,
        cycle: number,
        graphs: readonly OptionEvaluationGraph[],
    ): Promise<readonly string[]>;
}

/** Converts one option-search tree into a standalone, zoomable SVG document. */
export class BranchAndBoundSvgRenderer {
    private static readonly NODE_WIDTH = 300;
    private static readonly NODE_HEIGHT = 104;
    private static readonly HORIZONTAL_GAP = 150;
    private static readonly VERTICAL_GAP = 28;
    private static readonly PADDING = 48;
    private static readonly HEADER_HEIGHT = 176;
    private static readonly MISSION_BADGE_WIDTH = 134;

    render(
        graph: OptionEvaluationGraph,
        context: BranchAndBoundSvgContext,
    ): string {
        const root = this.buildTree(graph);
        if (!root) {
            return this.renderMissingRoot(graph, context);
        }

        const dimensions = this.layoutTree(root);
        const globallySelectedEdges = this.findGloballySelectedEdges(graph);
        const connections: string[] = [];
        const vertices: string[] = [];
        this.renderTree(
            root,
            globallySelectedEdges,
            connections,
            vertices,
        );

        const title = `Branch-and-bound cycle ${context.cycle}, pass ${context.pass}`;
        const excludedRoots = graph.excludedRootOptionIdentities.length > 0
            ? graph.excludedRootOptionIdentities.join(", ")
            : "none";
        return [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}"`
                + ` height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">`,
            `  <title>${this.escape(title)}</title>`,
            "  <defs>",
            "    <marker id=\"arrow-gray\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#64748b\"/></marker>",
            "    <marker id=\"arrow-green\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#16a34a\"/></marker>",
            "    <marker id=\"arrow-blue\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#2563eb\"/></marker>",
            "    <marker id=\"arrow-purple\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#7c3aed\"/></marker>",
            "    <marker id=\"arrow-amber\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#d97706\"/></marker>",
            "    <marker id=\"arrow-red\" markerWidth=\"9\" markerHeight=\"9\" refX=\"8\" refY=\"4.5\" orient=\"auto\"><path d=\"M0,0 L9,4.5 L0,9 z\" fill=\"#dc2626\"/></marker>",
            "    <style>",
            "      text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: #172033; }",
            "      .title { font: 700 22px system-ui, sans-serif; }",
            "      .summary { font: 14px system-ui, sans-serif; fill: #475569; }",
            "      .node-title { font-weight: 700; font-size: 13px; }",
            "      .node-detail { font-size: 11px; fill: #475569; }",
            "      .legend { font: 12px system-ui, sans-serif; fill: #334155; }",
            "      .mission-halo { fill: none; stroke: #f59e0b; stroke-width: 5; }",
            "      .mission-badge { fill: #f59e0b; stroke: #92400e; stroke-width: 1; }",
            "      .mission-badge-text { fill: #451a03; font: 700 11px system-ui, sans-serif; }",
            "      .replacement-halo { fill: none; stroke: #0891b2; stroke-width: 4; stroke-dasharray: 9 4; }",
            "      .replacement-badge { fill: #cffafe; stroke: #0891b2; stroke-width: 1; }",
            "      .replacement-badge-text { fill: #164e63; font: 700 11px system-ui, sans-serif; }",
            "    </style>",
            "  </defs>",
            "  <rect width=\"100%\" height=\"100%\" fill=\"#f8fafc\"/>",
            `  <text x="${BranchAndBoundSvgRenderer.PADDING}" y="38" class="title">${this.escape(title)}</text>`,
            `  <text x="${BranchAndBoundSvgRenderer.PADDING}" y="64" class="summary">agent=${this.escape(context.agentId || "unknown")} · nodes=${graph.nodes.length} · edges=${graph.edges.length} · best score=${graph.bestScore.toFixed(3)} · completion=${graph.estimatedCompletionMilliseconds}ms</text>`,
            `  <text x="${BranchAndBoundSvgRenderer.PADDING}" y="86" class="summary">excluded roots: ${this.escape(excludedRoots)}</text>`,
            ...this.renderLegend(),
            ...connections,
            ...vertices,
            "</svg>",
            "",
        ].join("\n");
    }

    private buildTree(graph: OptionEvaluationGraph): SvgTreeVertex | undefined {
        const verticesById = new Map<string, SvgTreeVertex>();
        for (const node of graph.nodes) {
            verticesById.set(node.id, {
                id: node.id,
                depth: node.depth,
                node,
                incomingEdge: undefined,
                children: [],
                parent: undefined,
                x: 0,
                y: 0,
            });
        }

        const edges = [...graph.edges].sort(
            (first: OptionEvaluationEdge, second: OptionEvaluationEdge): number => {
                if (first.sourceNodeId !== second.sourceNodeId) {
                    return first.sourceNodeId.localeCompare(second.sourceNodeId);
                }
                return first.order - second.order;
            },
        );
        for (const edge of edges) {
            const source = verticesById.get(edge.sourceNodeId);
            if (!source) {
                continue;
            }
            const existingTarget = edge.targetNodeId
                ? verticesById.get(edge.targetNodeId)
                : undefined;
            const target: SvgTreeVertex = existingTarget
                ? {
                    ...existingTarget,
                    incomingEdge: edge,
                    parent: source,
                }
                : {
                    id: `${edge.sourceNodeId}/unreachable-${edge.order}`,
                    depth: source.depth + 1,
                    node: undefined,
                    incomingEdge: edge,
                    children: [],
                    parent: source,
                    x: 0,
                    y: 0,
                };
            if (existingTarget) {
                verticesById.set(existingTarget.id, target);
            }
            source.children.push(target);
        }

        return verticesById.get(graph.rootNodeId);
    }

    private layoutTree(root: SvgTreeVertex): SvgDimensions {
        let nextLeafIndex = 0;
        let maximumDepth = 0;
        const positionVertex = (vertex: SvgTreeVertex): number => {
            maximumDepth = Math.max(maximumDepth, vertex.depth);
            vertex.x = BranchAndBoundSvgRenderer.PADDING
                + vertex.depth * (
                    BranchAndBoundSvgRenderer.NODE_WIDTH
                    + BranchAndBoundSvgRenderer.HORIZONTAL_GAP
                );
            if (vertex.children.length === 0) {
                vertex.y = BranchAndBoundSvgRenderer.HEADER_HEIGHT
                    + nextLeafIndex * (
                        BranchAndBoundSvgRenderer.NODE_HEIGHT
                        + BranchAndBoundSvgRenderer.VERTICAL_GAP
                    );
                nextLeafIndex += 1;
                return vertex.y;
            }
            const childPositions = vertex.children.map(positionVertex);
            vertex.y = childPositions.reduce(
                (total: number, position: number): number => total + position,
                0,
            ) / childPositions.length;
            return vertex.y;
        };
        positionVertex(root);

        return {
            width: Math.max(
                1280,
                BranchAndBoundSvgRenderer.PADDING * 2
                    + (maximumDepth + 1) * BranchAndBoundSvgRenderer.NODE_WIDTH
                    + maximumDepth * BranchAndBoundSvgRenderer.HORIZONTAL_GAP,
            ),
            height: Math.max(
                320,
                BranchAndBoundSvgRenderer.HEADER_HEIGHT
                    + Math.max(nextLeafIndex, 1) * (
                        BranchAndBoundSvgRenderer.NODE_HEIGHT
                        + BranchAndBoundSvgRenderer.VERTICAL_GAP
                    )
                    + BranchAndBoundSvgRenderer.PADDING,
            ),
        };
    }

    private renderTree(
        vertex: SvgTreeVertex,
        globallySelectedEdges: ReadonlySet<string>,
        connections: string[],
        vertices: string[],
    ): void {
        if (vertex.incomingEdge) {
            connections.push(
                this.renderConnection(vertex, globallySelectedEdges),
            );
        }
        vertices.push(this.renderVertex(vertex, globallySelectedEdges));
        for (const child of vertex.children) {
            this.renderTree(
                child,
                globallySelectedEdges,
                connections,
                vertices,
            );
        }
    }

    private renderConnection(
        target: SvgTreeVertex,
        globallySelectedEdges: ReadonlySet<string>,
    ): string {
        const edge = target.incomingEdge!;
        const sourceX = target.parent
            ? target.parent.x + BranchAndBoundSvgRenderer.NODE_WIDTH
            : target.x - BranchAndBoundSvgRenderer.HORIZONTAL_GAP;
        const sourceY = target.parent
            ? target.parent.y + BranchAndBoundSvgRenderer.NODE_HEIGHT / 2
            : target.y + BranchAndBoundSvgRenderer.NODE_HEIGHT / 2;
        const targetX = target.x;
        const targetY = target.y + BranchAndBoundSvgRenderer.NODE_HEIGHT / 2;
        const middleX = sourceX + BranchAndBoundSvgRenderer.HORIZONTAL_GAP / 2;
        const style = this.edgeStyle(edge, globallySelectedEdges);
        return `  <path d="M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}" fill="none" stroke="${style.color}" stroke-width="${style.width}"${style.dash} marker-end="url(#${style.marker})"/>`;
    }

    private renderVertex(
        vertex: SvgTreeVertex,
        globallySelectedEdges: ReadonlySet<string>,
    ): string {
        const edge = vertex.incomingEdge;
        const style = edge
            ? this.edgeStyle(edge, globallySelectedEdges)
            : { color: "#334155", fill: "#ffffff", width: 2, dash: "", marker: "arrow-gray" };
        const lines = edge
            ? this.edgeNodeLines(
                edge,
                vertex.node,
                globallySelectedEdges.has(this.edgeKey(edge)),
            )
            : this.rootNodeLines(vertex.node);
        const title = edge ? this.edgeTooltip(edge) : "Evaluator root state";
        const missionLabel = edge
            ? this.missionEffectLabel(edge)
            : undefined;
        const textLines = lines.map(
            (line: string, index: number): string =>
                `    <text x="${vertex.x + 14}" y="${vertex.y + 24 + index * 20}" class="${index === 0 ? "node-title" : "node-detail"}">${this.escape(line)}</text>`,
        );
        const missionDecoration = missionLabel
            ? this.renderMissionDecoration(vertex, missionLabel)
            : [];
        const replacementDecoration = edge?.isPenaltyReplacement
            ? this.renderReplacementDecoration(vertex)
            : [];
        return [
            "  <g>",
            `    <title>${this.escape(title)}</title>`,
            `    <rect x="${vertex.x}" y="${vertex.y}" width="${BranchAndBoundSvgRenderer.NODE_WIDTH}" height="${BranchAndBoundSvgRenderer.NODE_HEIGHT}" rx="10" fill="${style.fill}" stroke="${style.color}" stroke-width="${style.width}"${style.dash}/>` ,
            ...replacementDecoration,
            ...missionDecoration,
            ...textLines,
            "  </g>",
        ].join("\n");
    }

    private renderReplacementDecoration(vertex: SvgTreeVertex): string[] {
        const badgeX = vertex.x + 12;
        const badgeY = vertex.y - 12;
        return [
            `    <rect x="${vertex.x - 9}" y="${vertex.y - 9}" width="${BranchAndBoundSvgRenderer.NODE_WIDTH + 18}" height="${BranchAndBoundSvgRenderer.NODE_HEIGHT + 18}" rx="16" class="replacement-halo"/>`,
            `    <rect x="${badgeX}" y="${badgeY}" width="108" height="24" rx="12" class="replacement-badge"/>`,
            `    <text x="${badgeX + 54}" y="${badgeY + 16}" text-anchor="middle" class="replacement-badge-text">REPLACEMENT</text>`,
        ];
    }

    private renderMissionDecoration(
        vertex: SvgTreeVertex,
        label: string,
    ): string[] {
        const badgeX = vertex.x
            + BranchAndBoundSvgRenderer.NODE_WIDTH
            - BranchAndBoundSvgRenderer.MISSION_BADGE_WIDTH
            - 12;
        const badgeY = vertex.y - 12;
        return [
            `    <rect x="${vertex.x - 5}" y="${vertex.y - 5}" width="${BranchAndBoundSvgRenderer.NODE_WIDTH + 10}" height="${BranchAndBoundSvgRenderer.NODE_HEIGHT + 10}" rx="14" class="mission-halo"/>`,
            `    <rect x="${badgeX}" y="${badgeY}" width="${BranchAndBoundSvgRenderer.MISSION_BADGE_WIDTH}" height="24" rx="12" class="mission-badge"/>`,
            `    <text x="${badgeX + BranchAndBoundSvgRenderer.MISSION_BADGE_WIDTH / 2}" y="${badgeY + 16}" text-anchor="middle" class="mission-badge-text">${this.escape(label)}</text>`,
        ];
    }

    private missionEffectLabel(
        edge: OptionEvaluationEdge,
    ): string | undefined {
        const missionScore = edge.realizedCellScore
            + edge.realizedDeliveryMissionScore;
        if (
            edge.optionType !== "visit"
            && missionScore === 0
        ) {
            return undefined;
        }
        if (missionScore === 0) {
            return "★ MISSION";
        }
        return `★ MISSION ${missionScore > 0 ? "+" : ""}`
            + this.formatCompactScore(missionScore);
    }

    private formatCompactScore(score: number): string {
        return Number.isInteger(score) ? `${score}` : score.toFixed(3);
    }

    private rootNodeLines(node: OptionEvaluationNode | undefined): string[] {
        if (!node) {
            return ["ROOT MISSING"];
        }
        return [
            `ROOT · state (${node.position.x}, ${node.position.y})`,
            `elapsed ${node.elapsedMilliseconds}ms · carried ${this.carriedLabel(node)}`,
            `best next: ${node.selectedOptionIdentity ?? "STOP"}`,
        ];
    }

    private edgeNodeLines(
        edge: OptionEvaluationEdge,
        node: OptionEvaluationNode | undefined,
        globallySelected: boolean,
    ): string[] {
        const action = edge.optionType === "pick"
            ? `PICK ${edge.parcelId ?? "missing"}`
            : edge.optionType === "visit"
                ? "VISIT mission cell"
                : "DROP carried parcels";
        const decision = this.edgeDecisionLabel(edge, globallySelected);
        const score = edge.branchScore === undefined
            ? "n/a"
            : edge.branchScore.toFixed(3);
        const upperBound = edge.branchUpperBound === undefined
            ? "n/a"
            : edge.branchUpperBound.toFixed(3);
        return [
            `${action} → (${edge.targetPosition.x}, ${edge.targetPosition.y}) · ${decision}`,
            `${this.traversabilityLabel(edge.traversability)} · distance ${edge.estimatedDistance ?? "n/a"} · wait ${edge.deliveryWaitMilliseconds}ms · ETA ${edge.estimatedArrivalMilliseconds ?? "n/a"}ms`,
            `branch score ${score} · upper bound ${upperBound}`,
            node
                ? `state carried ${this.carriedLabel(node)} · next ${node.selectedOptionIdentity ?? "STOP"}`
                : edge.decision === OPTION_BRANCH_DECISION.PRUNED_BY_BOUND
                    ? "bound cannot improve the local incumbent"
                    : "branch rejected before creating a state",
        ];
    }

    private edgeDecisionLabel(
        edge: OptionEvaluationEdge,
        globallySelected: boolean,
    ): string {
        if (globallySelected) {
            return "SELECTED";
        }
        switch (edge.decision) {
            case OPTION_BRANCH_DECISION.UNREACHABLE:
                return "UNREACHABLE";
            case OPTION_BRANCH_DECISION.PRUNED_BY_BOUND:
                return "PRUNED";
            case OPTION_BRANCH_DECISION.SELECTED:
                return "LOCAL BEST";
            case OPTION_BRANCH_DECISION.LOWER_VALUE:
                return "ALTERNATIVE";
        }
    }

    private edgeTooltip(edge: OptionEvaluationEdge): string {
        return `${edge.optionIdentity}; penalty-replacement=${edge.isPenaltyReplacement}; traversability=${edge.traversability}; decision=${edge.decision}; distance=${edge.estimatedDistance ?? "n/a"}; wait=${edge.deliveryWaitMilliseconds}ms; arrival=${edge.estimatedArrivalMilliseconds ?? "n/a"}ms; realized-delivery-score=${edge.realizedDeliveryScore}; realized-drop-mission-score=${edge.realizedDeliveryMissionScore}; realized-cell-score=${edge.realizedCellScore}; estimated-action-score=${edge.estimatedActionScore ?? "n/a"}; remaining-parcel-score=${edge.remainingParcelScore ?? "n/a"}; upper-bound=${edge.branchUpperBound ?? "n/a"}; branch-score=${edge.branchScore ?? "n/a"}`;
    }

    private carriedLabel(node: OptionEvaluationNode): string {
        return node.carriedParcelIds.length > 0
            ? node.carriedParcelIds.join(",")
            : "none";
    }

    private edgeStyle(
        edge: OptionEvaluationEdge,
        globallySelectedEdges: ReadonlySet<string>,
    ): {
        readonly color: string;
        readonly fill: string;
        readonly width: number;
        readonly dash: string;
        readonly marker: string;
    } {
        if (globallySelectedEdges.has(this.edgeKey(edge))) {
            return {
                color: "#16a34a",
                fill: "#ecfdf5",
                width: 4,
                dash: "",
                marker: "arrow-green",
            };
        }
        if (edge.decision === OPTION_BRANCH_DECISION.UNREACHABLE) {
            return {
                color: "#dc2626",
                fill: "#fef2f2",
                width: 2,
                dash: " stroke-dasharray=\"7 5\"",
                marker: "arrow-red",
            };
        }
        if (edge.decision === OPTION_BRANCH_DECISION.PRUNED_BY_BOUND) {
            return {
                color: "#7c3aed",
                fill: "#f5f3ff",
                width: 2,
                dash: " stroke-dasharray=\"4 4\"",
                marker: "arrow-purple",
            };
        }
        if (edge.traversability === OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING) {
            return {
                color: "#d97706",
                fill: "#fffbeb",
                width: 2,
                dash: " stroke-dasharray=\"7 5\"",
                marker: "arrow-amber",
            };
        }
        if (edge.decision === OPTION_BRANCH_DECISION.SELECTED) {
            return {
                color: "#2563eb",
                fill: "#eff6ff",
                width: 2,
                dash: "",
                marker: "arrow-blue",
            };
        }
        return {
            color: "#64748b",
            fill: "#ffffff",
            width: 1.5,
            dash: "",
            marker: "arrow-gray",
        };
    }

    private findGloballySelectedEdges(
        graph: OptionEvaluationGraph,
    ): ReadonlySet<string> {
        const selectedEdges = new Set<string>();
        const nodesById = new Map<string, OptionEvaluationNode>(
            graph.nodes.map(
                (node: OptionEvaluationNode): [string, OptionEvaluationNode] =>
                    [node.id, node],
            ),
        );
        let currentNode = nodesById.get(graph.rootNodeId);
        while (currentNode?.selectedOptionIdentity) {
            const selectedEdge = graph.edges.find(
                (edge: OptionEvaluationEdge): boolean =>
                    edge.sourceNodeId === currentNode!.id
                    && edge.optionIdentity === currentNode!.selectedOptionIdentity,
            );
            if (!selectedEdge) {
                break;
            }
            selectedEdges.add(this.edgeKey(selectedEdge));
            currentNode = selectedEdge.targetNodeId
                ? nodesById.get(selectedEdge.targetNodeId)
                : undefined;
        }
        return selectedEdges;
    }

    private edgeKey(edge: OptionEvaluationEdge): string {
        return `${edge.sourceNodeId}:${edge.order}`;
    }

    private traversabilityLabel(
        traversability: OPTION_TRAVERSABILITY,
    ): string {
        switch (traversability) {
            case OPTION_TRAVERSABILITY.DIRECT:
                return "DIRECT";
            case OPTION_TRAVERSABILITY.REQUIRES_CRATE_PLANNING:
                return "CRATE-PLAN";
            case OPTION_TRAVERSABILITY.UNREACHABLE:
                return "UNREACHABLE";
        }
    }

    private renderLegend(): string[] {
        return [
            "  <line x1=\"48\" y1=\"116\" x2=\"78\" y2=\"116\" stroke=\"#16a34a\" stroke-width=\"4\"/><text x=\"86\" y=\"120\" class=\"legend\">final selected path</text>",
            "  <line x1=\"240\" y1=\"116\" x2=\"270\" y2=\"116\" stroke=\"#2563eb\" stroke-width=\"2\"/><text x=\"278\" y=\"120\" class=\"legend\">local best in alternative subtree</text>",
            "  <line x1=\"520\" y1=\"116\" x2=\"550\" y2=\"116\" stroke=\"#d97706\" stroke-width=\"2\" stroke-dasharray=\"7 5\"/><text x=\"558\" y=\"120\" class=\"legend\">crate-relaxed; requires PDDL</text>",
            "  <line x1=\"790\" y1=\"116\" x2=\"820\" y2=\"116\" stroke=\"#7c3aed\" stroke-width=\"2\" stroke-dasharray=\"4 4\"/><text x=\"828\" y=\"120\" class=\"legend\">pruned by bound</text>",
            "  <line x1=\"980\" y1=\"116\" x2=\"1010\" y2=\"116\" stroke=\"#dc2626\" stroke-width=\"2\" stroke-dasharray=\"7 5\"/><text x=\"1018\" y=\"120\" class=\"legend\">unreachable</text>",
            "  <rect x=\"48\" y=\"136\" width=\"24\" height=\"16\" rx=\"5\" fill=\"none\" stroke=\"#f59e0b\" stroke-width=\"4\"/><text x=\"82\" y=\"149\" class=\"legend\">mission cell or realized mission effect</text>",
            "  <rect x=\"400\" y=\"136\" width=\"24\" height=\"16\" rx=\"5\" fill=\"none\" stroke=\"#0891b2\" stroke-width=\"4\" stroke-dasharray=\"9 4\"/><text x=\"434\" y=\"149\" class=\"legend\">penalty-replacement delivery cell</text>",
        ];
    }

    private renderMissingRoot(
        graph: OptionEvaluationGraph,
        context: BranchAndBoundSvgContext,
    ): string {
        return [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"240\" viewBox=\"0 0 800 240\">",
            "  <rect width=\"100%\" height=\"100%\" fill=\"#f8fafc\"/>",
            `  <text x="40" y="60" font-family="system-ui" font-size="22" font-weight="700">Branch-and-bound cycle ${context.cycle}, pass ${context.pass}</text>`,
            `  <text x="40" y="110" font-family="system-ui" font-size="16" fill="#dc2626">Graph root “${this.escape(graph.rootNodeId)}” is missing.</text>`,
            "</svg>",
            "",
        ].join("\n");
    }

    private escape(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }
}

/** Writes one SVG per evaluator pass into the ignored runtime log directory. */
export class BranchAndBoundSvgWriter extends BaseBranchAndBoundGraphWriter {
    constructor(
        private readonly outputDirectory: string =
            process.env.BRANCH_BOUND_GRAPH_DIR ?? "logs/branch-and-bound",
        private readonly renderer: BranchAndBoundSvgRenderer =
            new BranchAndBoundSvgRenderer(),
    ) {
        super();
    }

    outputPaths(
        agentId: string,
        cycle: number,
        graphCount: number,
    ): readonly string[] {
        const absoluteOutputDirectory = resolve(this.outputDirectory);
        const safeAgentId = this.safeFileSegment(agentId || "unknown-agent");
        return Array.from(
            { length: graphCount },
            (_value: unknown, index: number): string => join(
                absoluteOutputDirectory,
                `${safeAgentId}-cycle-${cycle}-pass-${index + 1}.svg`,
            ),
        );
    }

    async writeGraphs(
        agentId: string,
        cycle: number,
        graphs: readonly OptionEvaluationGraph[],
    ): Promise<readonly string[]> {
        const absoluteOutputDirectory = resolve(this.outputDirectory);
        await mkdir(absoluteOutputDirectory, { recursive: true });
        const outputPaths = this.outputPaths(agentId, cycle, graphs.length);
        await Promise.all(graphs.map(
            async (graph: OptionEvaluationGraph, index: number): Promise<void> => {
                const svg = this.renderer.render(graph, {
                    agentId,
                    cycle,
                    pass: index + 1,
                });
                await writeFile(outputPaths[index], svg, "utf8");
            },
        ));
        return outputPaths;
    }

    private safeFileSegment(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, "_");
    }
}
