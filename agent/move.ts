import socket from "../index.js";

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
        console.log("Executing emitMove('up')");
        await socket.emitMove("up");
    }
}

export class MoveDown extends Action {
    constructor() {
        super(ActionType.MoveDown);
    }

    async execute() {
        console.log("Executing emitMove('down')");
        await socket.emitMove("down");
    }
}

export class MoveRight extends Action {
    constructor() {
        super(ActionType.MoveRight);
    }

    async execute() {
        console.log("Executing emitMove('right')");
        await socket.emitMove("right");
    }
}

export class MoveLeft extends Action {
    constructor() {
        super(ActionType.MoveLeft);
    }

    async execute() {
        console.log("Executing emitMove('left')");
        await socket.emitMove("left");
    }
}

export class PickUp extends Action {
    constructor() {
        super(ActionType.PickUp);
    }

    async execute() {
        console.log("Executing emitPickup()");
        await socket.emitPickup();
    }
}

export class Drop extends Action {
    constructor() {
        super(ActionType.Drop);
    }

    async execute() {
        console.log("Executing emitPutdown()");
        await socket.emitPutdown();
    }
}