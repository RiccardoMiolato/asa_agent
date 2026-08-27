import type { Beliefs } from "./beliefs.js";

export type MoveDirection = "up" | "right" | "left" | "down";

/** Minimal game-client contract required by executable actions. */
export interface GameClient {
    emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
    emitPickup(): Promise<{ id: string }[]>;
    emitPutdown(selected?: string[] | null): Promise<{ id: string }[]>;
}

export abstract class Action {
    abstract execute(): Promise<void>;
}

export class MoveUp extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitMove("up");
    }
}

export class MoveDown extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitMove("down");
    }
}

export class MoveRight extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitMove("right");
    }
}

export class MoveLeft extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitMove("left");
    }
}

export class PickUp extends Action {
    constructor(
        private readonly client: GameClient,
        private readonly beliefs: Beliefs,
        private readonly parcelId: string,
        private readonly agentId: string,
    ) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitPickup();
        this.beliefs.markParcelCarried(this.parcelId, this.agentId);
    }
}

export class Drop extends Action {
    constructor(
        private readonly client: GameClient,
        private readonly beliefs: Beliefs,
        private readonly agentId: string,
    ) {
        super();
    }

    async execute(): Promise<void> {
        await this.client.emitPutdown();
        this.beliefs.clearDeliveredParcels(this.agentId);
    }
}

/** Creates actions with their runtime dependencies already attached. */
export class ActionFactory {
    constructor(
        private readonly client: GameClient,
        private readonly beliefs: Beliefs,
    ) { }

    moveUp(): Action {
        return new MoveUp(this.client);
    }

    moveDown(): Action {
        return new MoveDown(this.client);
    }

    moveRight(): Action {
        return new MoveRight(this.client);
    }

    moveLeft(): Action {
        return new MoveLeft(this.client);
    }

    pickUp(parcelId: string, agentId: string): Action {
        return new PickUp(this.client, this.beliefs, parcelId, agentId);
    }

    drop(agentId: string): Action {
        return new Drop(this.client, this.beliefs, agentId);
    }
}
