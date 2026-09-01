import { Beliefs } from "../bdi/beliefs.js";
import { Position } from "./position.js";

export type MoveDirection = "up" | "right" | "left" | "down";

/** Minimal game-client contract required by executable actions. */
export interface GameClient {
    emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
    emitPickup(): Promise<{ id: string }[]>;
    emitPutdown(selected?: string[] | null): Promise<{ id: string }[]>;
}

export abstract class Action {
    abstract execute(): Promise<boolean>;
}

/** A movement action whose destination can be checked before server execution. */
export abstract class MovementAction extends Action {
    abstract destinationFrom(origin: Position): Position;
}

export class MoveUp extends MovementAction {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        return await this.client.emitMove("up") !== false;
    }

    destinationFrom(origin: Position): Position {
        return new Position(origin.x, origin.y + 1);
    }
}

export class MoveDown extends MovementAction {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        return await this.client.emitMove("down") !== false;
    }

    destinationFrom(origin: Position): Position {
        return new Position(origin.x, origin.y - 1);
    }
}

export class MoveRight extends MovementAction {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        return await this.client.emitMove("right") !== false;
    }

    destinationFrom(origin: Position): Position {
        return new Position(origin.x + 1, origin.y);
    }
}

export class MoveLeft extends MovementAction {
    constructor(private readonly client: GameClient) {
        super();
    }

    async execute(): Promise<boolean> {
        return await this.client.emitMove("left") !== false;
    }

    destinationFrom(origin: Position): Position {
        return new Position(origin.x - 1, origin.y);
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
        const pickedParcels = await this.client.emitPickup();
        const pickedTarget = pickedParcels.some(
            (parcel: { id: string }): boolean => parcel.id === this.parcelId,
        );
        if (!pickedTarget) {
            return false;
        }

        this.beliefs.markParcelCarried(this.parcelId, this.agentId);
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
