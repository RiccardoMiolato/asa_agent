import type { Beliefs } from "./beliefs.js";
import { Direction } from "./map.js";

export type MoveDirection = "up" | "right" | "left" | "down";

/** Minimal game-client contract required by executable actions. */
export interface GameClient {
    emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
    emitPickup(): Promise<{ id: string }[]>;
    emitPutdown(selected?: string[] | null): Promise<{ id: string }[]>;
}

export abstract class Action {
    abstract execute(): Promise<boolean>;

    protected async handleMoveAndRetry(client: GameClient, direction: Direction): Promise<{ x: number; y: number } | false> {
        const result = await client.emitMove(direction);

        if(result)
            return result;

        for(let i = 0; i < 2; i++) {
            const retry_res = await client.emitMove(direction);

            if(retry_res)
                return retry_res;
        }

        return false;
    }
}

export class MoveUp extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        const result = await this.handleMoveAndRetry(this.client, "up");

        return result ? true : false;
    }
}

export class MoveDown extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        const result = await this.handleMoveAndRetry(this.client, "down");

        return result ? true : false;
    }
}

export class MoveRight extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        const result = await this.handleMoveAndRetry(this.client, "right");

        return result ? true : false;
    }
}

export class MoveLeft extends Action {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        const result = await this.handleMoveAndRetry(this.client, "left");

        return result ? true : false;
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

    async execute(): Promise<boolean> {
        this.beliefs.markParcelCarried(this.parcelId, this.agentId);
        await this.client.emitPickup();
        return true;
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

    async execute(): Promise<boolean> {
        this.beliefs.clearDeliveredParcels(this.agentId);
        await this.client.emitPutdown();
        return true;
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
