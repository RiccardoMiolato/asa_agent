import type { Action } from "./move.js";

export class Plan {
    private actions: Action[];

    constructor() {
        this.actions = [];
    }

    newPlan(actions: Action[]): void {
        this.actions = actions;
    }

    topAction(): Action | null {
        if (this.actions.length === 0)
            return null;

        return this.actions[0];
    }

    popAction(): void {
        if (this.actions.length > 0)
            this.actions.shift();
    }

    isEmpty(): boolean {
        return this.actions.length == 0;
    }

    size(): number {
        return this.actions.length;
    }

}
