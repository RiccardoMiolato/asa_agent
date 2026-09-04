export class Plan {
    constructor() {
        this.actions = [];
    }
    newPlan(actions) {
        this.actions = actions;
    }
    topAction() {
        if (this.actions.length === 0)
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
//# sourceMappingURL=plan.js.map