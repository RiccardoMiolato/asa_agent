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
    emitSay(toId: string, message: unknown): Promise<"successful" | "failed">;
}

export abstract class Action {
    abstract execute(): Promise<boolean>;

    /** Delay applied by the executor immediately before this action. */
    executionDelayMilliseconds(defaultDelayMilliseconds: number): number {
        return defaultDelayMilliseconds;
    }
}

/** Intentional idle period represented as an executable, interruptible plan step. */
export class WaitAction extends Action {
    constructor(readonly delayMilliseconds: number) {
        super();
    }

    async execute(): Promise<true> {
        return true;
    }

    override executionDelayMilliseconds(
        _defaultDelayMilliseconds: number,
    ): number {
        return this.delayMilliseconds;
    }
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
    private deliveredParcelCount: number = 0;

    constructor(
        private readonly client: GameClient,
        private readonly beliefs: Beliefs,
        private readonly agentId: string,
    ) {
        super();
    }

    async execute(): Promise<boolean> {
        this.deliveredParcelCount = 0;
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
        this.deliveredParcelCount = expectedParcelIds.length;
        return true;
    }

    /** Whether this action completed a non-empty delivery. */
    deliveredParcels(): boolean {
        return this.deliveredParcelCount > 0;
    }
}

/** Puts down one parcel without treating the transfer as a delivery. */
export class PutDownParcelForHandoff extends Action {
    constructor(
        private readonly client: GameClient,
        private readonly beliefs: Beliefs,
        readonly parcelId: string,
        private readonly agentId: string,
        readonly handoffCell: Position,
    ) {
        super();
    }

    async execute(): Promise<boolean> {
        if (!this.beliefs.isParcelCarriedBy(this.parcelId, this.agentId)) {
            return true;
        }
        await this.client.emitPutdown([this.parcelId]);
        this.beliefs.markParcelDropped(
            this.parcelId,
            this.agentId,
            this.handoffCell,
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

    putDownForHandoff(
        parcelId: string,
        agentId: string,
        handoffCell: Position,
    ): Action {
        return new PutDownParcelForHandoff(
            this.client,
            this.beliefs,
            parcelId,
            agentId,
            handoffCell,
        );
    }

    wait(delayMilliseconds: number): Action {
        if (!Number.isFinite(delayMilliseconds) || delayMilliseconds <= 0) {
            throw new RangeError("Wait duration must be finite and positive");
        }
        return new WaitAction(delayMilliseconds);
    }
}
