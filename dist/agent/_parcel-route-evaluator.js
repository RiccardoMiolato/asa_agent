/** Parcel-route evaluation for pickup-first and delivery-first decisions. */
import { Position } from "./position.js";
/** Calculates comparable rewards for alternative parcel-delivery orderings. */
export class ParcelRouteEvaluator {
    /** Scores collecting one free parcel before delivering every carried parcel. */
    static scorePickupFirst(context, agentPosition, candidateParcel, candidatePosition) {
        const pickupDistance = context.pathfinder.pathLength(context.gameMap, agentPosition, candidatePosition, context.crates);
        const deliveryDistance = ParcelRouteEvaluator.shortestDeliveryDistance(context, candidatePosition);
        if (pickupDistance === undefined || deliveryDistance === undefined) {
            return ParcelRouteEvaluator.INVALID_ROUTE_SCORE;
        }
        const deliveryTime = ParcelRouteEvaluator.travelTime(pickupDistance + deliveryDistance, context.movementDuration);
        const candidateReward = ParcelRouteEvaluator.rewardAt(candidateParcel.reward, deliveryTime);
        if (candidateReward === 0) {
            return ParcelRouteEvaluator.INVALID_ROUTE_SCORE;
        }
        return candidateReward
            + ParcelRouteEvaluator.carriedRewardAt(context, deliveryTime);
    }
    /**
     * Scores delivering carried parcels first and then pursuing the best known
     * free parcel. The continuation is zero when no profitable parcel exists.
     */
    static scoreDeliveryFirst(context, agentPosition, deliveryCell) {
        const firstDeliveryDistance = context.pathfinder.pathLength(context.gameMap, agentPosition, deliveryCell, context.crates);
        if (firstDeliveryDistance === undefined) {
            return ParcelRouteEvaluator.INVALID_ROUTE_SCORE;
        }
        const firstDeliveryTime = ParcelRouteEvaluator.travelTime(firstDeliveryDistance, context.movementDuration);
        const carriedReward = ParcelRouteEvaluator.carriedRewardAt(context, firstDeliveryTime);
        if (carriedReward === 0) {
            return ParcelRouteEvaluator.INVALID_ROUTE_SCORE;
        }
        let bestContinuationReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            const parcelPosition = ParcelRouteEvaluator.parcelPosition(parcel);
            const pickupDistance = context.pathfinder.pathLength(context.gameMap, deliveryCell, parcelPosition, context.crates);
            const finalDeliveryDistance = ParcelRouteEvaluator.shortestDeliveryDistance(context, parcelPosition);
            if (pickupDistance === undefined || finalDeliveryDistance === undefined) {
                continue;
            }
            const finalDeliveryTime = ParcelRouteEvaluator.travelTime(firstDeliveryDistance + pickupDistance + finalDeliveryDistance, context.movementDuration);
            const continuationReward = ParcelRouteEvaluator.rewardAt(parcel.reward, finalDeliveryTime);
            bestContinuationReward = Math.max(bestContinuationReward, continuationReward);
        }
        return carriedReward + bestContinuationReward;
    }
    /** Returns the IDs of all parcels currently available for pickup. */
    static freeParcelIds(parcels) {
        const parcelIds = new Set();
        for (const parcel of parcels.values()) {
            if (!parcel.carriedBy) {
                parcelIds.add(parcel.id);
            }
        }
        return parcelIds;
    }
    /** Reports whether the known set of pickup candidates has changed. */
    static freeParcelSetChanged(previousParcelIds, parcels) {
        const currentParcelIds = ParcelRouteEvaluator.freeParcelIds(parcels);
        if (previousParcelIds.size !== currentParcelIds.size) {
            return true;
        }
        for (const parcelId of previousParcelIds) {
            if (!currentParcelIds.has(parcelId)) {
                return true;
            }
        }
        return false;
    }
    static carriedRewardAt(context, deliveryTime) {
        let reward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                reward += ParcelRouteEvaluator.rewardAt(parcel.reward, deliveryTime);
            }
        }
        return reward;
    }
    static shortestDeliveryDistance(context, startingPosition) {
        let shortestDistance;
        for (const deliveryCell of context.deliveringCells) {
            const distance = context.pathfinder.pathLength(context.gameMap, startingPosition, deliveryCell, context.crates);
            if (distance === undefined) {
                continue;
            }
            if (shortestDistance === undefined || distance < shortestDistance) {
                shortestDistance = distance;
            }
        }
        return shortestDistance;
    }
    static rewardAt(reward, elapsedSeconds) {
        return Math.max(0, reward - elapsedSeconds);
    }
    static travelTime(distance, movementDuration) {
        return (distance * movementDuration) / 1000;
    }
    static parcelPosition(parcel) {
        return new Position(parcel.x, parcel.y);
    }
}
ParcelRouteEvaluator.INVALID_ROUTE_SCORE = -1;
//# sourceMappingURL=_parcel-route-evaluator.js.map