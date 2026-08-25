import { Action } from "./move.js";

export class Plan {
    private actions: Action[];

    constructor() {
        this.actions = [];
    }

    newPlan(actions: Action[]){
        this.actions = actions;
    }

    topAction(): Action | null {
        if(this.actions.length === 0)
            return null;

        return this.actions[0];
    }

    popAction() {
        if (this.actions.length > 0)
            this.actions.shift();
    }

    isEmpty() {
        return this.actions.length == 0;
    }

    log() {
        console.log(this.actions);
    }
}