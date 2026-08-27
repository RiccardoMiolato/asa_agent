import type { BasePathfinder } from "./astar.js";
import type { Beliefs } from "./beliefs.js";
import type { IntentionGenerator } from "./desires.js";
import { SearchIntention, type Intention, type IntentionContext } from "./intentions.js";
import type { ActionFactory } from "./move.js";
import { Plan } from "./plan.js";
import { Position } from "./position.js";

/** Coordinates intention generation, selection, planning, and execution. */
export class Agent {
    id: string;
    readonly position: Position;

    private intentions: Intention[];
    private currentIntention: Intention;
    private readonly plan: Plan;

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
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));

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
            this.buildPlan();

            console.log("Proceeding with:");
            this.currentIntention.log(this.getIntentionContext());
            console.log();

            while (!this.plan.isEmpty()) {
                if (this.currentIntention.shouldInterrupt(this.getIntentionContext())) {
                    break;
                }

                await new Promise<void>((resolve) =>
                    setTimeout(resolve, this.beliefs.movement_duration)
                );

                const nextAction = this.plan.topAction();
                if (!nextAction) {
                    break;
                }

                await nextAction.execute();
                this.plan.popAction();
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
        let bestOption: Intention = new SearchIntention();
        let bestScore = bestOption.score(context);

        for (const intention of this.intentions) {
            const score = intention.score(context);
            if (score >= bestScore) {
                bestScore = score;
                bestOption = intention;
            }
        }

        this.currentIntention = bestOption;
    }

    buildPlan(): void {
        const actions = this.currentIntention.buildActions(this.getIntentionContext());
        this.plan.newPlan(actions);
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
