import type { PlanningContext } from "../../../planning.js";
import { Position } from "../../../utils/position.js";
import type { RendezvousObjective } from "./_objective.js";

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
