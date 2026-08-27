import { Position } from "./astar.js";
import beliefs from "./beliefs.js";
import optionGeneration from "./desires.js";
import { Intention, IntentionContext, SearchIntention } from "./intentions.js";
import { Plan } from "./plan.js";

/**
 * Class that manages the main agent logic
 * Keeps track of the agent statistics and continues to
 * check the environment to decide the best move available
 */
class Agent {
    id: string;
    position: Position;

    private intentions: Intention[];

    private currentIntention: Intention;
    private plan: Plan;

    constructor() {
        this.id = "";
        this.position = new Position(0, 0); // Initialize beliefs with default values

        this.intentions = [];

        this.currentIntention = new SearchIntention();
        this.plan = new Plan();
    }

    updatePosition(x: number, y: number): void {
        this.position.x = x;
        this.position.y = y;
    }

    /**
     * Main agent's logic loop
     */
    async agent_loop(): Promise<void> {
        await new Promise(r => setTimeout(r, 2000));
        while (true) {
            await new Promise(r => setTimeout(r, beliefs.movement_duration));

            const options = optionGeneration();

            this.addIntentions(options);

            options.forEach((option) => {
                option.log();
            });

            this.filterOptions();
            this.buildPlan();

            console.log("Proceding with: ");
            this.currentIntention.log();
            console.log();

            while (!this.plan.isEmpty()) {
                if (this.currentIntention.shouldInterrupt(this.getIntentionContext())) {
                    break;
                }

                await new Promise(r => setTimeout(r, beliefs.movement_duration));

                // console.log("Executing: ", this.plan.topAction());
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

    addIntention(intention: Intention) {
        this.intentions.push(intention);
    }

    addIntentions(intentions: Intention[]) {
        this.intentions = [];
        this.intentions = intentions;
    }

    clearIntentions() {
        this.intentions = [];
    }

    /**
     * Takes the best option to pursue
     */
    filterOptions(): void {
        let bestOption: Intention = new SearchIntention();
        let bestScore = bestOption.score(); // 0

        beliefs.updateParcelRewards();

        for (const intention of this.intentions) {
            const score = intention.score();

            if (score >= bestScore) {
                bestScore = score;
                bestOption = intention;
            }
        }

        this.currentIntention = bestOption;
    }

    /**
     * Plan how to behave
     */
    buildPlan(): void {
        const actions = this.currentIntention.buildActions(this.getIntentionContext());
        this.plan.newPlan(actions);
    }

    private getIntentionContext(): IntentionContext {
        return {
            gameMap: beliefs.map,
            agentPosition: this.position,
            crates: beliefs.crates,
            pickupCells: beliefs.pickup_cells,
            freeParcelsCount: beliefs.freeParcelsCount(),
            agentId: this.id,
        };
    }
}

export default new Agent();
