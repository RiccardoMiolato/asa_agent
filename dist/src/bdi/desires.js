import { OptimisticPathLengthEstimator } from "../_path-estimation.js";
import { DELIVERY_CANDIDATE_SELECTION_REASON, DELIVERY_PARCEL_REWARD_ELIGIBILITY, DELIVERY_SCORE_MODIFIER_IMPACT, DeliveryCandidateFactory, DeliveryCellEffect, } from "../_delivery-scoring.js";
import { PlanningObjective, } from "../planning.js";
import { Position } from "../utils/position.js";
/** Goal categories that can be considered by branch-and-bound. */
export var DESIRE_TYPE;
(function (DESIRE_TYPE) {
    DESIRE_TYPE["PICK_UP"] = "pick";
    DESIRE_TYPE["DELIVER"] = "drop";
    DESIRE_TYPE["VISIT"] = "visit";
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
    constructor(deliveryCandidate, waitMilliseconds = 0) {
        super(deliveryCandidate.cell);
        this.deliveryCandidate = deliveryCandidate;
        this.waitMilliseconds = waitMilliseconds;
        this.type = DESIRE_TYPE.DELIVER;
        this.parcelId = undefined;
    }
    scheduledAfter(waitMilliseconds) {
        return new DeliverParcelsDesire(this.deliveryCandidate, waitMilliseconds);
    }
    identity() {
        return `drop:${this.targetCell.x},${this.targetCell.y}`;
    }
    describe() {
        return {
            type: "deliver",
            target: this.targetCell,
            waitMilliseconds: this.waitMilliseconds,
        };
    }
}
/** Desire to deliberately collect a positive one-shot move-to reward. */
export class VisitCellDesire extends Desire {
    constructor(missionId, score, targetCell) {
        super(targetCell);
        this.missionId = missionId;
        this.score = score;
        this.type = DESIRE_TYPE.VISIT;
        this.parcelId = undefined;
    }
    identity() {
        return `visit:${this.missionId}`;
    }
    describe() {
        return {
            type: "visit",
            missionId: this.missionId,
            score: this.score,
            target: this.targetCell,
        };
    }
}
/** Derives possible goals from beliefs while limiting delivery-cell fan-out. */
export class DesireGenerator {
    generate(context, excludedRootDesireIdentities) {
        const rootDesires = new Set();
        const carriedParcelIds = [];
        const deliveryCellCandidates = this.selectDeliveryCellCandidates(context, excludedRootDesireIdentities);
        for (const effect of context.cellScoreEffects) {
            if (effect.score <= 0) {
                continue;
            }
            this.addRootDesire(rootDesires, new VisitCellDesire(effect.id, effect.score, effect.cell), excludedRootDesireIdentities);
        }
        for (const parcel of context.parcels.values()) {
            if (context.pickupExcludedParcelIds.has(parcel.id)) {
                continue;
            }
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
            for (const deliveryCandidate of deliveryCellCandidates) {
                this.addRootDesire(rootDesires, new DeliverParcelsDesire(deliveryCandidate), excludedRootDesireIdentities);
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
        // A one-shot drop mission can target an ordinary walkable (white)
        // cell. Add positive mission targets to the candidate pool even when
        // they are not regular map delivery cells.
        for (const effect of context.deliveryScoreEffects) {
            if (!(effect instanceof DeliveryCellEffect)
                || effect.modifier.impact()
                    !== DELIVERY_SCORE_MODIFIER_IMPACT.BONUS
                || !context.gameMap.isValidCell(effect.cell)
                || excludedRootDesireIdentities?.has(`drop:${effect.cell.x},${effect.cell.y}`)) {
                continue;
            }
            const distance = this.pathLengthAllowingCrateMoves(context, context.agentPosition, effect.cell);
            if (distance !== undefined) {
                distancesFromPresent.set(effect.cell, distance);
            }
        }
        const selectedCells = new Map();
        const nearestDeliveryCell = this.minimumDistanceCell(distancesFromPresent);
        if (nearestDeliveryCell !== undefined) {
            this.addDeliveryCell(selectedCells, nearestDeliveryCell);
        }
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
                this.addDeliveryCell(selectedCells, bestDeliveryCell);
            }
        }
        const candidates = new Map();
        for (const selectedCell of selectedCells.values()) {
            const selectedCandidate = this.makeDeliveryCandidate(context, selectedCell);
            if (!selectedCandidate.hasUnopposedCellPenalty()) {
                this.addDeliveryCandidate(candidates, selectedCandidate);
                continue;
            }
            const alternative = this.closestUnpenalizedDeliveryCandidate(context, selectedCell, distancesFromPresent.keys(), context.deliveryScoreEffects, selectedCells);
            if (alternative === undefined) {
                this.addDeliveryCandidate(candidates, selectedCandidate);
                continue;
            }
            this.addDeliveryCandidate(candidates, alternative.candidate);
            if (alternative.distance !== 1) {
                this.addDeliveryCandidate(candidates, selectedCandidate);
            }
        }
        for (const deliveryCell of distancesFromPresent.keys()) {
            const candidate = this.makeDeliveryCandidate(context, deliveryCell, DELIVERY_CANDIDATE_SELECTION_REASON.BONUS);
            if (candidate.hasCellBonus()) {
                this.addDeliveryCandidate(candidates, candidate);
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
    closestUnpenalizedDeliveryCandidate(context, penalizedCell, deliveryCells, effects, originallySelectedCells) {
        let closestCandidate;
        let closestDistance = Infinity;
        for (const deliveryCell of deliveryCells) {
            if (deliveryCell.isEqual(penalizedCell)) {
                continue;
            }
            const candidate = this.makeDeliveryCandidate(context, deliveryCell, originallySelectedCells.has(this.deliveryCellKey(deliveryCell))
                ? DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL
                : DELIVERY_CANDIDATE_SELECTION_REASON.PENALTY_REPLACEMENT, effects);
            if (candidate.hasUnopposedCellPenalty()) {
                continue;
            }
            const distance = this.pathLengthAllowingCrateMoves(context, penalizedCell, deliveryCell);
            if (distance !== undefined && distance < closestDistance) {
                closestCandidate = candidate;
                closestDistance = distance;
            }
        }
        return closestCandidate === undefined
            ? undefined
            : { candidate: closestCandidate, distance: closestDistance };
    }
    addDeliveryCell(cells, deliveryCell) {
        cells.set(this.deliveryCellKey(deliveryCell), deliveryCell);
    }
    makeDeliveryCandidate(context, cell, selectionReason = DELIVERY_CANDIDATE_SELECTION_REASON.ORIGINAL, effects = context.deliveryScoreEffects) {
        const isRegularDeliveryCell = context.deliveringCells.some((deliveryCell) => deliveryCell.isEqual(cell));
        return DeliveryCandidateFactory.make(cell, effects, selectionReason, isRegularDeliveryCell
            ? DELIVERY_PARCEL_REWARD_ELIGIBILITY.ELIGIBLE
            : DELIVERY_PARCEL_REWARD_ELIGIBILITY.MISSION_ONLY);
    }
    addDeliveryCandidate(candidates, candidate) {
        const key = this.deliveryCellKey(candidate.cell);
        if (!candidates.has(key)) {
            candidates.set(key, candidate);
        }
    }
    deliveryCellKey(deliveryCell) {
        return `${deliveryCell.x},${deliveryCell.y}`;
    }
}
//# sourceMappingURL=desires.js.map