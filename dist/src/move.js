import { Position } from "./position.js";
export class Action {
}
/** A movement action whose destination can be checked before server execution. */
export class MovementAction extends Action {
}
export class MoveUp extends MovementAction {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        return await this.client.emitMove("up") !== false;
    }
    destinationFrom(origin) {
        return new Position(origin.x, origin.y + 1);
    }
}
export class MoveDown extends MovementAction {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        return await this.client.emitMove("down") !== false;
    }
    destinationFrom(origin) {
        return new Position(origin.x, origin.y - 1);
    }
}
export class MoveRight extends MovementAction {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        return await this.client.emitMove("right") !== false;
    }
    destinationFrom(origin) {
        return new Position(origin.x + 1, origin.y);
    }
}
export class MoveLeft extends MovementAction {
    constructor(client) {
        super();
        this.client = client;
    }
    async execute() {
        return await this.client.emitMove("left") !== false;
    }
    destinationFrom(origin) {
        return new Position(origin.x - 1, origin.y);
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
        if (this.beliefs.isParcelCarriedBy(this.parcelId, this.agentId)) {
            return true;
        }
        this.beliefs.beginPickupAttempt(this.parcelId, this.agentId);
        let pickupCompleted = false;
        try {
            const pickedParcels = await this.client.emitPickup();
            for (const parcel of pickedParcels) {
                this.beliefs.markParcelCarried(parcel.id, this.agentId);
            }
            // Missing target acknowledgement is inconclusive: continue the
            // plan with correctable ownership instead of failing the action.
            if (!pickedParcels.some((parcel) => parcel.id === this.parcelId)) {
                this.beliefs.markParcelProvisionallyCarried(this.parcelId, this.agentId);
            }
            pickupCompleted = true;
            return true;
        }
        finally {
            this.beliefs.endPickupAttempt(this.parcelId, pickupCompleted);
        }
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
        const expectedParcelIds = this.beliefs.carriedParcelIds(this.agentId);
        if (expectedParcelIds.length === 0) {
            return true;
        }
        await this.client.emitPutdown([...expectedParcelIds]);
        // Delivery-cell validation belongs to planning. Once putdown has
        // completed, a missing or partial acknowledgement must not make the
        // agent retry an already executed delivery.
        this.beliefs.markParcelsDelivered(this.agentId, new Set(expectedParcelIds));
        return true;
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