import { PlanningObjective, } from "./planning.js";
import { OptimisticPathLengthEstimator } from "./_path-estimation.js";
import { Position } from "./position.js";
/** Goal categories that can be considered by branch-and-bound. */
export var DESIRE_TYPE;
(function (DESIRE_TYPE) {
    DESIRE_TYPE["PICK_UP"] = "pick";
    DESIRE_TYPE["DELIVER"] = "drop";
})(DESIRE_TYPE || (DESIRE_TYPE = {}));
/** A possible reward-bearing goal derived from the agent's beliefs. */
export class Desire extends PlanningObjective {
    constructor(targetCell) {
        super();
        this.targetCell = targetCell;
    }
}
/** Desire to collect one known free parcel. */
export class PickUpParcelDesire extends Desire {
    constructor(parcelId, targetCell) {
        super(targetCell);
        this.parcelId = parcelId;
        this.type = DESIRE_TYPE.PICK_UP;
    }
    identity() {
        return `pick:${this.parcelId}`;
    }
    describe() {
        return {
            type: "pick-up",
            parcelId: this.parcelId,
            target: this.targetCell,
        };
    }
}
/** Desire to deliver every parcel currently carried by the agent. */
export class DeliverParcelsDesire extends Desire {
    constructor() {
        super(...arguments);
        this.type = DESIRE_TYPE.DELIVER;
        this.parcelId = undefined;
    }
    identity() {
        return `drop:${this.targetCell.x},${this.targetCell.y}`;
    }
    describe() {
        return {
            type: "deliver",
            target: this.targetCell,
        };
    }
}
/** Derives possible goals from beliefs while limiting delivery-cell fan-out. */
export class DesireGenerator {
    generate(context, excludedRootDesireIdentities) {
        const rootDesires = new Set();
        const carriedParcelIds = [];
        const deliveryCellCandidates = this.selectDeliveryCellCandidates(context);
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedParcelIds.push(parcel.id);
                continue;
            }
            if (parcel.carriedBy) {
                continue;
            }
            this.addRootDesire(rootDesires, new PickUpParcelDesire(parcel.id, new Position(parcel.x, parcel.y)), excludedRootDesireIdentities);
        }
        if (carriedParcelIds.length > 0) {
            for (const deliveryCell of this.selectDeliveryCellCandidates(context, excludedRootDesireIdentities)) {
                this.addRootDesire(rootDesires, new DeliverParcelsDesire(deliveryCell), excludedRootDesireIdentities);
            }
        }
        return {
            rootDesires,
            carriedParcelIds,
            deliveryCellCandidates,
        };
    }
    addRootDesire(desires, desire, excludedRootDesireIdentities) {
        if (excludedRootDesireIdentities?.has(desire.identity())) {
            return;
        }
        desires.add(desire);
    }
    /**
     * Keeps the nearest delivery cell and the cheapest delivery detour from the
     * present cell toward every known free parcel.
     */
    selectDeliveryCellCandidates(context, excludedRootDesireIdentities) {
        const distancesFromPresent = new Map();
        for (const deliveryCell of context.deliveringCells) {
            if (excludedRootDesireIdentities?.has(`drop:${deliveryCell.x},${deliveryCell.y}`)) {
                continue;
            }
            const distance = this.pathLengthAllowingCrateMoves(context, context.agentPosition, deliveryCell);
            if (distance !== undefined) {
                distancesFromPresent.set(deliveryCell, distance);
            }
        }
        const nearestDeliveryCell = this.minimumDistanceCell(distancesFromPresent);
        if (nearestDeliveryCell === undefined) {
            return [];
        }
        const candidates = new Map();
        this.addDeliveryCellCandidate(candidates, nearestDeliveryCell);
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            const pickupPosition = new Position(parcel.x, parcel.y);
            let bestDeliveryCell;
            let bestDetourDistance = Infinity;
            for (const [deliveryCell, distanceFromPresent] of distancesFromPresent) {
                const deliveryToPickup = this.pathLengthAllowingCrateMoves(context, deliveryCell, pickupPosition);
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
    pathLengthAllowingCrateMoves(context, startingPosition, targetPosition) {
        return OptimisticPathLengthEstimator.estimate(context, startingPosition, targetPosition);
    }
    minimumDistanceCell(distances) {
        let closestCell;
        let closestDistance = Infinity;
        for (const [cell, distance] of distances) {
            if (distance < closestDistance) {
                closestCell = cell;
                closestDistance = distance;
            }
        }
        return closestCell;
    }
    addDeliveryCellCandidate(candidates, deliveryCell) {
        candidates.set(`${deliveryCell.x},${deliveryCell.y}`, deliveryCell);
    }
}
//# sourceMappingURL=desires.js.map