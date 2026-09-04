import { GameMap } from "./map.js";
import { RewardIntention, } from "./intentions.js";
import { Position } from "./position.js";
/** Labels navigation regions when currently known crates are treated as walls. */
class CrateBlockedRegionIndex {
    constructor(gameMap, crates) {
        this.gameMap = gameMap;
        this.componentByPosition = new Map();
        this.blockedPositions = new Set([...crates.values()].map((crate) => this.positionKey(crate)));
        this.indexComponents();
    }
    componentAt(position) {
        return this.componentByPosition.get(this.positionKey(position));
    }
    indexComponents() {
        let nextComponentId = 0;
        for (let row = 0; row < this.gameMap.length; row++) {
            for (let column = 0; column < (this.gameMap[row]?.length ?? 0); column++) {
                const position = new Position(row, column);
                const key = this.positionKey(position);
                if (this.componentByPosition.has(key)
                    || !this.isTraversable(position)) {
                    continue;
                }
                this.indexComponentFrom(position, nextComponentId);
                nextComponentId += 1;
            }
        }
    }
    indexComponentFrom(start, componentId) {
        const pending = [start];
        this.componentByPosition.set(this.positionKey(start), componentId);
        for (let index = 0; index < pending.length; index++) {
            const current = pending[index];
            for (const neighbor of this.neighborsOf(current)) {
                const neighborKey = this.positionKey(neighbor);
                if (this.componentByPosition.has(neighborKey)
                    || !this.isTraversable(neighbor)) {
                    continue;
                }
                this.componentByPosition.set(neighborKey, componentId);
                pending.push(neighbor);
            }
        }
    }
    neighborsOf(position) {
        return [
            new Position(position.x, position.y + 1),
            new Position(position.x, position.y - 1),
            new Position(position.x + 1, position.y),
            new Position(position.x - 1, position.y),
        ];
    }
    isTraversable(position) {
        if (position.x < 0
            || position.x >= this.gameMap.length
            || position.y < 0
            || position.y >= (this.gameMap[position.x]?.length ?? 0)) {
            return false;
        }
        return this.gameMap[position.x][position.y] !== "0"
            && !this.blockedPositions.has(this.positionKey(position));
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
}
/** Orders the initial best/reachable/diverse trio, then preserves score order. */
class DiverseCandidateQueue {
    constructor(rankedCandidates) {
        this.orderedCandidates = this.makeDiverseOrder(rankedCandidates);
        this.nextIndex = 0;
    }
    takeNext() {
        const candidate = this.orderedCandidates[this.nextIndex];
        if (candidate) {
            this.nextIndex += 1;
        }
        return candidate;
    }
    makeDiverseOrder(rankedCandidates) {
        const first = rankedCandidates[0];
        if (!first) {
            return [];
        }
        const ordered = [];
        const selectedIntentions = new Set();
        this.addCandidate(first, ordered, selectedIntentions);
        const reachableAlternative = rankedCandidates.find((candidate) => candidate.aStarDistance !== undefined
            && !selectedIntentions.has(candidate.intention));
        this.addCandidate(reachableAlternative, ordered, selectedIntentions);
        const differentComponent = rankedCandidates.find((candidate) => candidate.componentId !== undefined
            && candidate.componentId !== first.componentId
            && !selectedIntentions.has(candidate.intention));
        this.addCandidate(differentComponent, ordered, selectedIntentions);
        for (const candidate of rankedCandidates) {
            this.addCandidate(candidate, ordered, selectedIntentions);
        }
        return ordered;
    }
    addCandidate(candidate, ordered, selectedIntentions) {
        if (!candidate || selectedIntentions.has(candidate.intention)) {
            return;
        }
        selectedIntentions.add(candidate.intention);
        ordered.push(candidate);
    }
}
/** Refines optimistic reward options using reusable A* or Fast Downward plans. */
export class IntentionRefiner {
    constructor(pddlPlanner, config) {
        this.pddlPlanner = pddlPlanner;
        this.config = {
            feasibleCandidateLimit: IntentionRefiner.positiveInteger(config?.feasibleCandidateLimit, IntentionRefiner.DEFAULT_FEASIBLE_CANDIDATE_LIMIT),
            planningBudgetMilliseconds: IntentionRefiner.positiveInteger(config?.planningBudgetMilliseconds
                ?? Number(process.env.PDDL_REFINEMENT_BUDGET_MS), IntentionRefiner.DEFAULT_PLANNING_BUDGET_MILLISECONDS),
        };
        this.unreachableWorldKey = "";
        this.unreachableTargetKeys = new Set();
    }
    async refine(evaluations, context) {
        this.synchronizeUnreachableCache(context);
        const updatedEvaluations = new Map(evaluations.map((evaluation) => [
            evaluation.intention,
            evaluation,
        ]));
        const candidates = this.makeCandidates(evaluations, context, updatedEvaluations);
        const queue = new DiverseCandidateQueue(candidates);
        const feasiblePlans = [];
        const refinementStartedAt = Date.now();
        while (feasiblePlans.length < this.config.feasibleCandidateLimit) {
            const candidate = queue.takeNext();
            if (!candidate) {
                break;
            }
            const remainingBudget = this.config.planningBudgetMilliseconds
                - (Date.now() - refinementStartedAt);
            if (candidate.aStarDistance === undefined
                && remainingBudget <= 0) {
                continue;
            }
            const outcome = await this.refineCandidate(candidate, context, Math.max(1, remainingBudget));
            this.recordOutcome(candidate, outcome, feasiblePlans, updatedEvaluations);
        }
        return {
            selected: this.selectBestPlan(feasiblePlans),
            evaluations: evaluations.map((evaluation) => updatedEvaluations.get(evaluation.intention) ?? evaluation),
        };
    }
    makeCandidates(evaluations, context, updatedEvaluations) {
        const regionIndex = new CrateBlockedRegionIndex(context.gameMap, context.crates);
        const candidates = [];
        const rankedEvaluations = [...evaluations].sort(IntentionRefiner.compareEvaluations);
        for (const evaluation of rankedEvaluations) {
            if (!(evaluation.intention instanceof RewardIntention)) {
                continue;
            }
            if (evaluation.score < 0) {
                continue;
            }
            const goal = evaluation.intention.toPddlGoal(context);
            if (!goal) {
                continue;
            }
            const targetKey = this.positionKey(goal.finalTargetPosition);
            if (this.unreachableTargetKeys.has(targetKey)) {
                updatedEvaluations.set(evaluation.intention, {
                    ...evaluation,
                    score: -1,
                    distance: undefined,
                    status: "unreachable",
                });
                continue;
            }
            candidates.push({
                evaluation,
                intention: evaluation.intention,
                target: goal.finalTargetPosition,
                componentId: regionIndex.componentAt(goal.finalTargetPosition),
                aStarDistance: context.pathfinder.pathLength(context.gameMap, context.agentPosition, goal.finalTargetPosition, context.crates),
            });
        }
        return candidates;
    }
    async refineCandidate(candidate, context, timeoutMilliseconds) {
        if (candidate.aStarDistance !== undefined) {
            const navigationActions = context.pathfinder.findPath(context.gameMap, context.agentPosition, candidate.target, context.crates);
            return this.makeSolvedOutcome(candidate, context, navigationActions);
        }
        const goal = candidate.intention.toPddlGoal(context);
        if (!goal) {
            return { status: "unreachable" };
        }
        const result = await this.pddlPlanner.solveNavigation({
            map: new GameMap(context.gameMap),
            crates: [...context.crates.values()],
            playerId: context.agentId,
            playerPosition: context.agentPosition,
            goal,
            timeoutMilliseconds,
        });
        return this.fromPDDLResult(candidate, context, result);
    }
    fromPDDLResult(candidate, context, result) {
        switch (result.status) {
            case "solved":
                return this.makeSolvedOutcome(candidate, context, result.plan.actions);
            case "unreachable":
                return { status: "unreachable" };
            case "timeout":
                return { status: "timeout" };
            case "error":
                return { status: "error" };
        }
    }
    makeSolvedOutcome(candidate, context, navigationActions) {
        const score = candidate.intention.scoreWithNavigationDistance(context, navigationActions.length);
        if (score < 0) {
            return { status: "unprofitable" };
        }
        return {
            status: "solved",
            plan: {
                intention: candidate.intention,
                score,
                distance: navigationActions.length,
                actions: [
                    ...navigationActions,
                    ...candidate.intention.buildPddlCompletionActions(context),
                ],
            },
        };
    }
    recordOutcome(candidate, outcome, feasiblePlans, updatedEvaluations) {
        if (outcome.status === "solved") {
            feasiblePlans.push(outcome.plan);
            updatedEvaluations.set(candidate.intention, {
                intention: candidate.intention,
                score: outcome.plan.score,
                distance: outcome.plan.distance,
                status: "refined",
            });
            return;
        }
        if (outcome.status === "unreachable") {
            this.unreachableTargetKeys.add(this.positionKey(candidate.target));
        }
        updatedEvaluations.set(candidate.intention, {
            intention: candidate.intention,
            score: -1,
            distance: undefined,
            status: outcome.status,
        });
    }
    selectBestPlan(feasiblePlans) {
        return [...feasiblePlans].sort((first, second) => second.score - first.score || first.distance - second.distance)[0];
    }
    synchronizeUnreachableCache(context) {
        const worldKey = this.worldKey(context);
        if (worldKey === this.unreachableWorldKey) {
            return;
        }
        this.unreachableWorldKey = worldKey;
        this.unreachableTargetKeys.clear();
    }
    worldKey(context) {
        const mapKey = context.gameMap.map((row) => row.join(",")).join(";");
        const crateKey = [...context.crates.values()]
            .map((crate) => this.positionKey(crate))
            .sort()
            .join("|");
        return `${context.agentPosition.x},${context.agentPosition.y}:${mapKey}:${crateKey}`;
    }
    positionKey(position) {
        return `${position.x},${position.y}`;
    }
    static compareEvaluations(first, second) {
        return second.score - first.score
            || (first.distance ?? Number.POSITIVE_INFINITY)
                - (second.distance ?? Number.POSITIVE_INFINITY);
    }
    static positiveInteger(value, fallback) {
        return value !== undefined && Number.isFinite(value) && value > 0
            ? Math.floor(value)
            : fallback;
    }
}
IntentionRefiner.DEFAULT_FEASIBLE_CANDIDATE_LIMIT = 3;
IntentionRefiner.DEFAULT_PLANNING_BUDGET_MILLISECONDS = 30000;
//# sourceMappingURL=_intention-refinement.js.map