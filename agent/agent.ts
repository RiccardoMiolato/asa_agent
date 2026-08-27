import { Astar, Position } from "./astar.js";
import beliefs from "./beliefs.js";
import optionGeneration from "./desires.js";
import { DeliverParcelIntention, Intention, IntentionType, PickUpParcelIntention, SearchIntention } from "./intentions.js";
import { Action, Drop, PickUp } from "./move.js";
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
    async agent_loop() {
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
                if (this.currentIntention.getType() == IntentionType.SearchPacket && beliefs.freeParcelsCount() > 0) {
                    break;
                }

                await new Promise(r => setTimeout(r, beliefs.movement_duration));

                // console.log("Executing: ", this.plan.topAction());
                const nextAction = this.plan.topAction();
                await nextAction?.execute();

                if (nextAction instanceof PickUp) {
                    beliefs.parcels.forEach(parcel => {
                        if (parcel.id === (this.currentIntention as PickUpParcelIntention).parcel.id) {
                            if (!parcel.carriedBy)
                                parcel.carriedBy = this.id;
                        }
                    })
                }

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
    buildPlan() {
        let actions: Action[];
        switch (this.currentIntention.getType()) {
            case IntentionType.PickUpPacket:
                actions = Astar(
                    beliefs.map,
                    this.position,
                    (this.currentIntention as PickUpParcelIntention).parcelPosition,
                    beliefs.crates,
                    undefined,
                );

                actions.push(new PickUp());
                this.plan.newPlan(actions);
                break;
            case IntentionType.DeliverPacket:
                actions = Astar(
                    beliefs.map,
                    this.position,
                    (this.currentIntention as DeliverParcelIntention).deliveryCell,
                    beliefs.crates,
                    undefined,
                );

                actions.push(new Drop());
                this.plan.newPlan(actions);
                break;
            case IntentionType.SearchPacket:
                let index = Math.floor(Math.random() * beliefs.pickup_cells.length);
                (this.currentIntention as SearchIntention).targetLocation = beliefs.pickup_cells[index];

                actions = Astar(
                    beliefs.map,
                    this.position,
                    (this.currentIntention as SearchIntention).targetLocation!,
                    beliefs.crates,
                    undefined,
                );

                this.plan.newPlan(actions);
                break;
        }
    }
}

export default new Agent();