import { OptimisticPathLengthEstimator } from "../_path-estimation.js";
import {
    PlanningObjective,
    type PlanningContext,
    type PlanningObjectiveDescription,
} from "../planning.js";
import { Position } from "../utils/position.js";
import type { CellScoreEffectId } from "../utils/_cell-score-effects.js";

/** Goal categories that can be considered by branch-and-bound. */
export enum DESIRE_TYPE {
    PICK_UP = "pick",
    DELIVER = "drop",
    VISIT = "visit",
}

/** A possible reward-bearing goal derived from the agent's beliefs. */
export abstract class Desire extends PlanningObjective {
    abstract readonly type: DESIRE_TYPE;
    abstract readonly parcelId: string | undefined;

    constructor(readonly targetCell: Position) {
        super();
    }

    /** Stable identity used to exclude a failed root during the same deliberation. */
    abstract identity(): string;
    abstract describe(): PlanningObjectiveDescription;
}

/** Desire to collect one known free parcel. */
export class PickUpParcelDesire extends Desire {
    readonly type = DESIRE_TYPE.PICK_UP;

    constructor(
        readonly parcelId: string,
        targetCell: Position,
    ) {
        super(targetCell);
    }

    identity(): string {
        return `pick:${this.parcelId}`;
    }

    describe(): PlanningObjectiveDescription {
        return {
            type: "pick-up",
            parcelId: this.parcelId,
            target: this.targetCell,
        };
    }
}

/** Desire to deliver every parcel currently carried by the agent. */
export class DeliverParcelsDesire extends Desire {
    readonly type = DESIRE_TYPE.DELIVER;
    readonly parcelId = undefined;

    identity(): string {
        return `drop:${this.targetCell.x},${this.targetCell.y}`;
    }

    describe(): PlanningObjectiveDescription {
        return {
            type: "deliver",
            target: this.targetCell,
        };
    }
}

/** Desire to deliberately collect a positive one-shot move-to reward. */
export class VisitCellDesire extends Desire {
    readonly type = DESIRE_TYPE.VISIT;
    readonly parcelId = undefined;

    constructor(
        readonly missionId: CellScoreEffectId,
        readonly score: number,
        targetCell: Position,
    ) {
        super(targetCell);
    }

    identity(): string {
        return `visit:${this.missionId}`;
    }

    describe(): PlanningObjectiveDescription {
        return {
            type: "visit",
            missionId: this.missionId,
            score: this.score,
            target: this.targetCell,
        };
    }
}

/** Typed snapshot of the desires generated for one deliberation. */
export interface DesireGeneration {
    readonly rootDesires: ReadonlySet<Desire>;
    readonly carriedParcelIds: readonly string[];
    readonly deliveryCellCandidates: readonly Position[];
}

/** Derives possible goals from beliefs while limiting delivery-cell fan-out. */
export class DesireGenerator {
    generate(
        context: PlanningContext,
        excludedRootDesireIdentities?: ReadonlySet<string>,
    ): DesireGeneration {
        const rootDesires = new Set<Desire>();
        const carriedParcelIds: string[] = [];
        const deliveryCellCandidates = this.selectDeliveryCellCandidates(context);

        for (const effect of context.cellScoreEffects) {
            if (effect.score <= 0) {
                continue;
            }
            this.addRootDesire(
                rootDesires,
                new VisitCellDesire(effect.id, effect.score, effect.cell),
                excludedRootDesireIdentities,
            );
        }

        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedParcelIds.push(parcel.id);
                continue;
            }
            if (parcel.carriedBy) {
                continue;
            }

            this.addRootDesire(
                rootDesires,
                new PickUpParcelDesire(
                    parcel.id,
                    new Position(parcel.x, parcel.y),
                ),
                excludedRootDesireIdentities,
            );
        }

        if (carriedParcelIds.length > 0) {
            for (const deliveryCell of this.selectDeliveryCellCandidates(
                context,
                excludedRootDesireIdentities,
            )) {
                this.addRootDesire(
                    rootDesires,
                    new DeliverParcelsDesire(deliveryCell),
                    excludedRootDesireIdentities,
                );
            }
        }

        return {
            rootDesires,
            carriedParcelIds,
            deliveryCellCandidates,
        };
    }

    private addRootDesire(
        desires: Set<Desire>,
        desire: Desire,
        excludedRootDesireIdentities: ReadonlySet<string> | undefined,
    ): void {
        if (excludedRootDesireIdentities?.has(desire.identity())) {
            return;
        }
        desires.add(desire);
    }

    /**
     * Keeps the nearest delivery cell and the cheapest delivery detour from the
     * present cell toward every known free parcel.
     */
    private selectDeliveryCellCandidates(
        context: PlanningContext,
        excludedRootDesireIdentities?: ReadonlySet<string>,
    ): readonly Position[] {
        const distancesFromPresent = new Map<Position, number>();
        for (const deliveryCell of context.deliveringCells) {
            if (
                excludedRootDesireIdentities?.has(
                    `drop:${deliveryCell.x},${deliveryCell.y}`,
                )
            ) {
                continue;
            }

            const distance = this.pathLengthAllowingCrateMoves(
                context,
                context.agentPosition,
                deliveryCell,
            );
            if (distance !== undefined) {
                distancesFromPresent.set(deliveryCell, distance);
            }
        }

        const nearestDeliveryCell = this.minimumDistanceCell(
            distancesFromPresent,
        );
        if (nearestDeliveryCell === undefined) {
            return [];
        }

        const candidates = new Map<string, Position>();
        this.addDeliveryCellCandidate(candidates, nearestDeliveryCell);

        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }

            const pickupPosition = new Position(parcel.x, parcel.y);
            let bestDeliveryCell: Position | undefined;
            let bestDetourDistance = Infinity;
            for (const [deliveryCell, distanceFromPresent]
                of distancesFromPresent) {
                const deliveryToPickup = this.pathLengthAllowingCrateMoves(
                    context,
                    deliveryCell,
                    pickupPosition,
                );
                if (deliveryToPickup === undefined) {
                    continue;
                }

                const detourDistance = distanceFromPresent + deliveryToPickup;
                if (detourDistance < bestDetourDistance) {
                    bestDeliveryCell = deliveryCell;
                    bestDetourDistance = detourDistance;
                }
            }

            if (bestDeliveryCell !== undefined) {
                this.addDeliveryCellCandidate(candidates, bestDeliveryCell);
            }
        }

        return [...candidates.values()];
    }

    private pathLengthAllowingCrateMoves(
        context: PlanningContext,
        startingPosition: Position,
        targetPosition: Position,
    ): number | undefined {
        return OptimisticPathLengthEstimator.estimate(
            context,
            startingPosition,
            targetPosition,
        );
    }

    private minimumDistanceCell(
        distances: ReadonlyMap<Position, number>,
    ): Position | undefined {
        let closestCell: Position | undefined;
        let closestDistance = Infinity;
        for (const [cell, distance] of distances) {
            if (distance < closestDistance) {
                closestCell = cell;
                closestDistance = distance;
            }
        }
        return closestCell;
    }

    private addDeliveryCellCandidate(
        candidates: Map<string, Position>,
        deliveryCell: Position,
    ): void {
        candidates.set(
            `${deliveryCell.x},${deliveryCell.y}`,
            deliveryCell,
        );
    }
}
