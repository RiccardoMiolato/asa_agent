import type { PlanningContext } from "../../../bdi/planning.js";
import type { BasePathfinder } from "../../../utils/astar.js";
import type { GameMap } from "../../../utils/map.js";
import { Position } from "../../../utils/position.js";
import type { RendezvousObjective } from "./_objective.js";
import type { GridPositionObjective } from "./_position-objective.js";

/** Two distinct walkable cells selected for one rendezvous. */
export interface RendezvousPositionSelection {
    readonly llmAgentTarget: Position;
    readonly bdiAgentTarget: Position;
}

interface ReachableCandidate {
    readonly position: Position;
    readonly distanceFromAgent: number;
    readonly distanceFromCenter: number;
}

/** Minimum world state needed to resolve a position predicate. */
export interface GridPositionSelectionContext {
    readonly gameMap: GameMap;
    readonly agentPosition: Position;
    readonly crates: ReadonlyMap<string, Position>;
    readonly pathfinder: BasePathfinder;
}

/** Contract for resolving a position predicate to one reachable map cell. */
export abstract class BaseGridPositionSelector {
    abstract select(
        context: GridPositionSelectionContext,
        objective: GridPositionObjective,
        excludedPositions?: readonly Position[],
    ): Position | undefined;
}

/** Selects the physically closest safe cell satisfying both axis constraints. */
export class ReachableGridPositionSelector extends BaseGridPositionSelector {
    override select(
        context: GridPositionSelectionContext,
        objective: GridPositionObjective,
        excludedPositions: readonly Position[] = [],
    ): Position | undefined {
        let selected: Position | undefined;
        let selectedDistance = Infinity;

        for (let x = 0; x < context.gameMap.getRows(); x += 1) {
            for (let y = 0; y < context.gameMap.getCols(); y += 1) {
                if (!objective.matches(x, y)) {
                    continue;
                }
                const candidate = new Position(x, y);
                if (
                    !context.gameMap.isValidCell(candidate)
                    || this.isOccupiedByCrate(context, candidate)
                    || excludedPositions.some(
                        (excluded: Position): boolean =>
                            excluded.isEqual(candidate),
                    )
                ) {
                    continue;
                }
                const distance = context.pathfinder.pathLength(
                    context.gameMap,
                    context.agentPosition,
                    candidate,
                    context.crates,
                );
                if (distance === undefined) {
                    continue;
                }
                if (
                    distance < selectedDistance
                    || distance === selectedDistance
                        && this.compareCoordinates(candidate, selected) < 0
                ) {
                    selected = candidate;
                    selectedDistance = distance;
                }
            }
        }
        return selected;
    }

    private isOccupiedByCrate(
        context: GridPositionSelectionContext,
        position: Position,
    ): boolean {
        return [...context.crates.values()].some(
            (crate: Position): boolean => crate.isEqual(position),
        );
    }

    private compareCoordinates(
        first: Position,
        second: Position | undefined,
    ): number {
        if (!second) {
            return -1;
        }
        return first.x - second.x || first.y - second.y;
    }
}

/** Contract for assigning rendezvous cells to the two participating agents. */
export abstract class BaseRendezvousPositionSelector {
    abstract select(
        context: PlanningContext,
        objective: RendezvousObjective,
    ): RendezvousPositionSelection | undefined;
}

/**
 * Selects distinct, crate-free cells in the local agent's reachable component.
 *
 * The LLM target minimizes its current travel distance. The peer target then
 * minimizes distance to the requested center and to the LLM target. This is a
 * deterministic foundation; peer-aware allocation can replace it once the BDI
 * agent communicates its own planning state.
 */
export class ReachableRendezvousPositionSelector
    extends BaseRendezvousPositionSelector {
    override select(
        context: PlanningContext,
        objective: RendezvousObjective,
    ): RendezvousPositionSelection | undefined {
        const candidates = this.reachableCandidates(context, objective);
        if (candidates.length < 2) {
            return undefined;
        }

        const llmCandidate = [...candidates].sort(
            (
                first: ReachableCandidate,
                second: ReachableCandidate,
            ): number => this.compareLlmCandidates(first, second),
        )[0];
        if (!llmCandidate) {
            return undefined;
        }

        const bdiCandidate = candidates
            .filter(
                (candidate: ReachableCandidate): boolean =>
                    !candidate.position.isEqual(llmCandidate.position),
            )
            .sort(
                (
                    first: ReachableCandidate,
                    second: ReachableCandidate,
                ): number => this.compareBdiCandidates(
                    first,
                    second,
                    llmCandidate.position,
                ),
            )[0];
        if (!bdiCandidate) {
            return undefined;
        }

        return {
            llmAgentTarget: llmCandidate.position,
            bdiAgentTarget: bdiCandidate.position,
        };
    }

    private reachableCandidates(
        context: PlanningContext,
        objective: RendezvousObjective,
    ): ReachableCandidate[] {
        const candidates: ReachableCandidate[] = [];
        for (
            let x = objective.center.x - objective.maximumDistance;
            x <= objective.center.x + objective.maximumDistance;
            x += 1
        ) {
            for (
                let y = objective.center.y - objective.maximumDistance;
                y <= objective.center.y + objective.maximumDistance;
                y += 1
            ) {
                const position = new Position(x, y);
                const distanceFromCenter = position.distanceTo(
                    objective.center,
                );
                if (distanceFromCenter > objective.maximumDistance) {
                    continue;
                }
                if (!context.gameMap.isValidCell(position)) {
                    continue;
                }
                if (this.isOccupiedByCrate(context, position)) {
                    continue;
                }

                const distanceFromAgent = context.pathfinder.pathLength(
                    context.gameMap,
                    context.agentPosition,
                    position,
                    context.crates,
                    context.cellScoreEffects,
                );
                if (distanceFromAgent === undefined) {
                    continue;
                }
                candidates.push({
                    position,
                    distanceFromAgent,
                    distanceFromCenter,
                });
            }
        }
        return candidates;
    }

    private isOccupiedByCrate(
        context: PlanningContext,
        position: Position,
    ): boolean {
        return [...context.crates.values()].some(
            (crate: Position): boolean => crate.isEqual(position),
        );
    }

    private compareLlmCandidates(
        first: ReachableCandidate,
        second: ReachableCandidate,
    ): number {
        return first.distanceFromAgent - second.distanceFromAgent
            || first.distanceFromCenter - second.distanceFromCenter
            || first.position.x - second.position.x
            || first.position.y - second.position.y;
    }

    private compareBdiCandidates(
        first: ReachableCandidate,
        second: ReachableCandidate,
        llmTarget: Position,
    ): number {
        return first.distanceFromCenter - second.distanceFromCenter
            || first.position.distanceTo(llmTarget)
                - second.position.distanceTo(llmTarget)
            || first.position.x - second.position.x
            || first.position.y - second.position.y;
    }
}
