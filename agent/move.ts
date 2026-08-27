import socket from "../index.js";
import beliefs from "./beliefs.js";

export abstract class Action {
    abstract execute(): Promise<void>;
}

export class MoveUp extends Action {
    async execute(): Promise<void> {
        await socket.emitMove("up");
    }
}

export class MoveDown extends Action {
    async execute(): Promise<void> {
        await socket.emitMove("down");
    }
}

export class MoveRight extends Action {
    async execute(): Promise<void> {
        await socket.emitMove("right");
    }
}

export class MoveLeft extends Action {
    async execute(): Promise<void> {
        await socket.emitMove("left");
    }
}

export class PickUp extends Action {
    constructor(
        private readonly parcelId: string,
        private readonly agentId: string,
    ) {
        super();
    }

    async execute(): Promise<void> {
        await socket.emitPickup();
        beliefs.markParcelCarried(this.parcelId, this.agentId);
    }
}

export class Drop extends Action {
    async execute(): Promise<void> {
        await socket.emitPutdown();
        beliefs.clearDeliveredParcels();
    }
}
