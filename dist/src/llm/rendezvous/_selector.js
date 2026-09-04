import { Position } from "../../utils/position.js";
/** Contract for assigning rendezvous cells to the two participating agents. */
export class BaseRendezvousPositionSelector {
}
/**
 * Selects distinct, crate-free cells in the local agent's reachable component.
 *
 * The LLM target minimizes its current travel distance. The peer target then
 * minimizes distance to the requested center and to the LLM target. This is a
 * deterministic foundation; peer-aware allocation can replace it once the BDI
 * agent communicates its own planning state.
 */
export class ReachableRendezvousPositionSelector extends BaseRendezvousPositionSelector {
    select(context, objective) {
        const candidates = this.reachableCandidates(context, objective);
        if (candidates.length < 2) {
            return undefined;
        }
        const llmCandidate = [...candidates].sort((first, second) => this.compareLlmCandidates(first, second))[0];
        if (!llmCandidate) {
            return undefined;
        }
        const bdiCandidate = candidates
            .filter((candidate) => !candidate.position.isEqual(llmCandidate.position))
            .sort((first, second) => this.compareBdiCandidates(first, second, llmCandidate.position))[0];
        if (!bdiCandidate) {
            return undefined;
        }
        return {
            llmAgentTarget: llmCandidate.position,
            bdiAgentTarget: bdiCandidate.position,
        };
    }
    reachableCandidates(context, objective) {
        const candidates = [];
        for (let x = objective.center.x - objective.maximumDistance; x <= objective.center.x + objective.maximumDistance; x += 1) {
            for (let y = objective.center.y - objective.maximumDistance; y <= objective.center.y + objective.maximumDistance; y += 1) {
                const position = new Position(x, y);
                const distanceFromCenter = position.distanceTo(objective.center);
                if (distanceFromCenter > objective.maximumDistance) {
                    continue;
                }
                if (!context.gameMap.isValidCell(position)) {
                    continue;
                }
                if (this.isOccupiedByCrate(context, position)) {
                    continue;
                }
                const distanceFromAgent = context.pathfinder.pathLength(context.gameMap, context.agentPosition, position, context.crates, context.cellScoreEffects);
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
    isOccupiedByCrate(context, position) {
        return [...context.crates.values()].some((crate) => crate.isEqual(position));
    }
    compareLlmCandidates(first, second) {
        return first.distanceFromAgent - second.distanceFromAgent
            || first.distanceFromCenter - second.distanceFromCenter
            || first.position.x - second.position.x
            || first.position.y - second.position.y;
    }
    compareBdiCandidates(first, second, llmTarget) {
        return first.distanceFromCenter - second.distanceFromCenter
            || first.position.distanceTo(llmTarget)
                - second.position.distanceTo(llmTarget)
            || first.position.x - second.position.x
            || first.position.y - second.position.y;
    }
}
//# sourceMappingURL=_selector.js.map