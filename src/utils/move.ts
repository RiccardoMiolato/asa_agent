import { Beliefs } from "../bdi/beliefs.js";
import { Position } from "./position.js";

export type MoveDirection = "up" | "right" | "left" | "down";

/** Stable parcel identity returned by action acknowledgements. */
export interface ParcelActionAcknowledgement {
    readonly id: string;
}

/** Minimal game-client contract required by executable actions. */
export interface GameClient {
    emitMove(direction: MoveDirection): Promise<{ x: number; y: number } | false>;
    emitPickup(): Promise<readonly ParcelActionAcknowledgement[]>;
    emitPutdown(
        selected?: string[] | null,
    ): Promise<readonly ParcelActionAcknowledgement[]>;
    emitSay (toId: string, msg: any ): Promise<'successful' | 'failed'>;
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
            if (!pickedParcels.some(
                (parcel: ParcelActionAcknowledgement): boolean =>
                    parcel.id === this.parcelId,
            )) {
                this.beliefs.markParcelProvisionallyCarried(
                    this.parcelId,
                    this.agentId,
                );
            }
            pickupCompleted = true;
            return true;
        } finally {
            this.beliefs.endPickupAttempt(
                this.parcelId,
                pickupCompleted,
            );
        }
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
        const expectedParcelIds = this.beliefs.carriedParcelIds(this.agentId);
        if (expectedParcelIds.length === 0) {
            return true;
        }

        await this.client.emitPutdown(
            [...expectedParcelIds],
        );

        // Delivery-cell validation belongs to planning. Once putdown has
        // completed, a missing or partial acknowledgement must not make the
        // agent retry an already executed delivery.
        this.beliefs.markParcelsDelivered(
            this.agentId,
            new Set<string>(expectedParcelIds),
        );
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
