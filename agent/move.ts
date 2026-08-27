import socket from "../index.js";
import beliefs from "./beliefs.js";

enum ActionType {
    Null,
    MoveUp,
    MoveDown,
    MoveRight,
    MoveLeft,
    PickUp,
    Drop
}

export class Action {
    actionType: ActionType;

    constructor(actionType: ActionType = ActionType.Null) {
        this.actionType = actionType;
    }

    async execute() {
        throw new Error("Method not implemented");
    }
}

export class MoveUp extends Action {
    constructor() {
        super(ActionType.MoveUp);
    }

    async execute() {
        await socket.emitMove("up");
    }
}

export class MoveDown extends Action {
    constructor() {
        super(ActionType.MoveDown);
    }

    async execute() {
        await socket.emitMove("down");
    }
}

export class MoveRight extends Action {
    constructor() {
        super(ActionType.MoveRight);
    }

    async execute() {
        await socket.emitMove("right");
    }
}

export class MoveLeft extends Action {
    constructor() {
        super(ActionType.MoveLeft);
    }

    async execute() {
        await socket.emitMove("left");
    }
}

export class PickUp extends Action {
    constructor(
        private readonly parcelId: string,
        private readonly agentId: string,
    ) {
        super(ActionType.PickUp);
    }

    async execute(): Promise<void> {
        await socket.emitPickup();
        beliefs.markParcelCarried(this.parcelId, this.agentId);
    }
}

export class Drop extends Action {
    constructor() {
        super(ActionType.Drop);
    }

    async execute() {
        await socket.emitPutdown();
        beliefs.clearDeliveredParcels();
    }
}
