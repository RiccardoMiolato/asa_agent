export class Action {
}
export class MoveUp extends Action {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        await this.client.emitMove("up");
    }
}
export class MoveDown extends Action {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        await this.client.emitMove("down");
    }
}
export class MoveRight extends Action {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        await this.client.emitMove("right");
    }
}
export class MoveLeft extends Action {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        await this.client.emitMove("left");
    }
}
export class PickUp extends Action {
    constructor(client, beliefs, parcelId, agentId) {
        super();
        this.client = client;
        this.beliefs = beliefs;
        this.parcelId = parcelId;
        this.agentId = agentId;
    }
    async execute() {
        await this.client.emitPickup();
        this.beliefs.markParcelCarried(this.parcelId, this.agentId);
    }
}
export class Drop extends Action {
    constructor(client, beliefs, agentId) {
        super();
        this.client = client;
        this.beliefs = beliefs;
        this.agentId = agentId;
    }
    async execute() {
        await this.client.emitPutdown();
        this.beliefs.clearDeliveredParcels(this.agentId);
    }
}
/** Creates actions with their runtime dependencies already attached. */
export class ActionFactory {
    constructor(client, beliefs) {
        this.client = client;
        this.beliefs = beliefs;
    }
    moveUp() {
        return new MoveUp(this.client);
    }
    moveDown() {
        return new MoveDown(this.client);
    }
    moveRight() {
        return new MoveRight(this.client);
    }
    moveLeft() {
        return new MoveLeft(this.client);
    }
    pickUp(parcelId, agentId) {
        return new PickUp(this.client, this.beliefs, parcelId, agentId);
    }
    drop(agentId) {
        return new Drop(this.client, this.beliefs, agentId);
    }
}
//# sourceMappingURL=move.js.map