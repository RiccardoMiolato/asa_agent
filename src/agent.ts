import type { BasePathfinder } from "./astar.js";
import type { Beliefs } from "./beliefs.js";
import type { IntentionGenerator } from "./desires.js";
import { Intention, SearchIntention, type IntentionContext } from "./intentions.js";
import { GameMap } from "./map.js";
import type { ActionFactory } from "./move.js";
import { PDDLGoal, PDDLPlanner } from "./pddl/pddlPlanner.js";
import { Plan } from "./plan.js";
import { Position } from "./position.js";

/** Coordinates intention generation, selection, planning, and execution. */
export class Agent {
    id: string;
    readonly position: Position;

    private intentions: Intention[];
    private currentIntention: Intention;
    private readonly plan: Plan;

    private pddlPlanner: PDDLPlanner | undefined = undefined;

    constructor(
        private readonly beliefs: Beliefs,
        private readonly intentionGenerator: IntentionGenerator,
        private readonly pathfinder: BasePathfinder,
        private readonly actionFactory: ActionFactory,
    ) {
        this.id = "";
        this.position = new Position(0, 0);
        this.intentions = [];
        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
    }

    updatePosition(x: number, y: number): void {
        this.position.x = x;
        this.position.y = y;
    }

    /** Continuously selects and executes the most valuable available intention. */
    async agent_loop(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));

        this.pddlPlanner = new PDDLPlanner(this.actionFactory);

        while (true) {
            await new Promise<void>((resolve) =>
                setTimeout(resolve, this.beliefs.movement_duration)
            );

            const options = this.intentionGenerator.generate({
                id: this.id,
                position: this.position,
            });
            this.addIntentions(options);

            const loggingContext = this.getIntentionContext();
            options.forEach((option: Intention) => option.log(loggingContext));

            this.filterOptions();

            await this.buildPlan();

            console.log("Proceeding with:");
            this.currentIntention.log(this.getIntentionContext());
            this.beliefs.parcels.forEach(parcel => parcel.carriedBy === this.id ? console.log(parcel.id) : {});
            console.log();

            while (!this.plan.isEmpty()) {
                const context = this.getIntentionContext();
                if (this.currentIntention.shouldInterrupt(context)) {
                    break;
                }

                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );

                const nextAction = this.plan.topAction();
                if (!nextAction) {
                    break;
                }

                console.log("Exetuting");
                const result = await nextAction.execute();

                if(!result) {
                    await this.buildPlan();
                } else{
                    this.plan.popAction();
                }
            }
        }
    }

    getIntentions(): readonly Intention[] {
        return this.intentions;
    }

    addIntention(intention: Intention): void {
        this.intentions.push(intention);
    }

    addIntentions(intentions: Intention[]): void {
        this.intentions = intentions;
    }

    clearIntentions(): void {
        this.intentions = [];
    }

    /** Selects the highest-scoring intention, falling back to exploration. */
    filterOptions(): void {
        this.beliefs.updateParcelRewards();
        const context = this.getIntentionContext();
        let bestOption: Intention | undefined = undefined;
        let bestScore = Number.MIN_VALUE;

        for (const intention of this.intentions) {
            const score = intention.score(context);
            intention.log(this.getIntentionContext());
            console.log("Score: ", score);
            if (score >= bestScore) {
                bestScore = score;
                bestOption = intention;
            }
        }

        if(bestOption)
            this.currentIntention = bestOption;
    }

    async buildPlan(): Promise<void> {
        const context: IntentionContext = this.getIntentionContext();

        const actions = this.currentIntention.buildActions(context);

        if(actions.length > 0){
            console.log("here");
            this.plan.newPlan(actions);
            return;
        }

        // If normal pathfinding algorithms cannot find a path
        // then PDDL is used because its likely that the path
        // must be cleared moving crates

        console.log("Build plan with PDDL");
        this.pddlPlanner?.resetPDDL();

        this.pddlPlanner?.buildPDDLProblem(
            new GameMap(context.gameMap),
            [...context.parcels.values()],
            [...context.crates.values()],
            this.id,
            this.position,
        );

        if(this.currentIntention) {
            const pddlGoal: PDDLGoal = this.currentIntention.toPddlGoal(context);
            this.pddlPlanner?.buildGoal(pddlGoal);
            const actions = await this.pddlPlanner?.solveProblem() || [];
            this.plan.newPlan(actions);
        }

    }

    private getIntentionContext(): IntentionContext {
        return {
            gameMap: this.beliefs.map,
            agentPosition: this.position,
            crates: this.beliefs.crates,
            pickupCells: this.beliefs.pickup_cells,
            deliveringCells: this.beliefs.delivering_cells,
            parcels: this.beliefs.parcels,
            movementDuration: this.beliefs.movement_duration,
            freeParcelsCount: this.beliefs.freeParcelsCount(),
            agentId: this.id,
            pathfinder: this.pathfinder,
            actionFactory: this.actionFactory,
        };
    }
}
