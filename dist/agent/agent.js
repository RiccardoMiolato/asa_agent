import { SearchIntention } from "./intentions.js";
import { Plan } from "./plan.js";
import { Position } from "./position.js";
/** Coordinates intention generation, selection, planning, and execution. */
export class Agent {
    constructor(beliefs, intentionGenerator, pathfinder, actionFactory) {
        this.beliefs = beliefs;
        this.intentionGenerator = intentionGenerator;
        this.pathfinder = pathfinder;
        this.actionFactory = actionFactory;
        this.id = "";
        this.position = new Position(0, 0);
        this.intentions = [];
        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
    }
    updatePosition(x, y) {
        this.position.x = x;
        this.position.y = y;
    }
    /** Continuously selects and executes the most valuable available intention. */
    async agent_loop() {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        while (true) {
            await new Promise((resolve) => setTimeout(resolve, this.beliefs.movement_duration));
            const options = this.intentionGenerator.generate({
                id: this.id,
                position: this.position,
            });
            this.addIntentions(options);
            const loggingContext = this.getIntentionContext();
            options.forEach((option) => option.log(loggingContext));
            this.filterOptions();
            this.buildPlan();
            console.log("Proceeding with:");
            this.currentIntention.log(this.getIntentionContext());
            console.log();
            while (!this.plan.isEmpty()) {
                if (this.currentIntention.shouldInterrupt(this.getIntentionContext())) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, this.beliefs.movement_duration));
                const nextAction = this.plan.topAction();
                if (!nextAction) {
                    break;
                }
                await nextAction.execute();
                this.plan.popAction();
            }
        }
    }
    getIntentions() {
        return this.intentions;
    }
    addIntention(intention) {
        this.intentions.push(intention);
    }
    addIntentions(intentions) {
        this.intentions = intentions;
    }
    clearIntentions() {
        this.intentions = [];
    }
    /** Selects the highest-scoring intention, falling back to exploration. */
    filterOptions() {
        this.beliefs.updateParcelRewards();
        const context = this.getIntentionContext();
        let bestOption = new SearchIntention();
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
    buildPlan() {
        const actions = this.currentIntention.buildActions(this.getIntentionContext());
        this.plan.newPlan(actions);
    }
    getIntentionContext() {
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
//# sourceMappingURL=agent.js.map