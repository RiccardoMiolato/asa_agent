import { Position } from "./position.js";
export class Intention {
    shouldInterrupt(_context) {
        return false;
    }
}
/** Explores parcel pickup cells when no more valuable intention exists. */
export class SearchIntention extends Intention {
    score(_context) {
        return 0;
    }
    buildActions(context) {
        const index = Math.floor(Math.random() * context.pickupCells.length);
        const targetLocation = context.pickupCells[index];
        if (!targetLocation) {
            this.targetLocation = undefined;
            return [];
        }
        this.targetLocation = targetLocation;
        return context.pathfinder.findPath(context.gameMap, context.agentPosition, targetLocation, context.crates);
    }
    shouldInterrupt(context) {
        return context.freeParcelsCount > 0;
    }
    log(_context) {
        const target = this.targetLocation
            ? `(${this.targetLocation.x};${this.targetLocation.y})`
            : "undefined";
        console.log(`\x1b[33mSearchPacket at ${target}\x1b[0m`);
    }
}
/** Picks up a known parcel when its expected reward is positive. */
export class PickUpParcelIntention extends Intention {
    constructor(parcel, parcelPosition) {
        super();
        this.parcel = parcel;
        this.parcelPosition = parcelPosition;
    }
    score(context) {
        const pickupDistance = context.pathfinder.pathLength(context.gameMap, context.agentPosition, this.parcelPosition, context.crates);
        if (pickupDistance === undefined) {
            return -1;
        }
        let shortestDeliveryDistance;
        for (const deliveryCell of context.deliveringCells) {
            const deliveryDistance = context.pathfinder.pathLength(context.gameMap, this.parcelPosition, deliveryCell, context.crates);
            if (deliveryDistance === undefined) {
                continue;
            }
            if (shortestDeliveryDistance === undefined
                || deliveryDistance < shortestDeliveryDistance) {
                shortestDeliveryDistance = deliveryDistance;
            }
        }
        if (shortestDeliveryDistance === undefined) {
            return -1;
        }
        const deliveryTime = ((pickupDistance + shortestDeliveryDistance)
            * context.movementDuration) / 1000;
        const candidateReward = Math.max(0, this.parcel.reward - deliveryTime);
        if (candidateReward === 0) {
            return -1;
        }
        let totalReward = candidateReward;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                totalReward += Math.max(0, parcel.reward - deliveryTime);
            }
        }
        return totalReward;
    }
    buildActions(context) {
        const actions = context.pathfinder.findPath(context.gameMap, context.agentPosition, this.parcelPosition, context.crates);
        actions.push(context.actionFactory.pickUp(this.parcel.id, context.agentId));
        return actions;
    }
    log(context) {
        console.log(`\x1b[32mPickUp packet from (${this.parcelPosition.x};${this.parcelPosition.y}) - Score: ${this.score(context)}\x1b[0m`);
    }
}
/** Delivers all parcels currently carried by the agent. */
export class DeliverParcelIntention extends Intention {
    constructor(deliveryCell, knownFreeParcelIds) {
        super();
        this.deliveryCell = deliveryCell;
        this.knownFreeParcelIds = new Set(knownFreeParcelIds);
    }
    score(context) {
        const firstDeliveryDistance = context.pathfinder.pathLength(context.gameMap, context.agentPosition, this.deliveryCell, context.crates);
        if (firstDeliveryDistance === undefined) {
            return -1;
        }
        const firstDeliveryTime = (firstDeliveryDistance * context.movementDuration) / 1000;
        let carriedReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy === context.agentId) {
                carriedReward += Math.max(0, parcel.reward - firstDeliveryTime);
            }
        }
        if (carriedReward === 0) {
            return -1;
        }
        let bestContinuationReward = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            const parcelPosition = new Position(parcel.x, parcel.y);
            const pickupDistance = context.pathfinder.pathLength(context.gameMap, this.deliveryCell, parcelPosition, context.crates);
            if (pickupDistance === undefined) {
                continue;
            }
            let shortestDeliveryDistance;
            for (const finalDeliveryCell of context.deliveringCells) {
                const deliveryDistance = context.pathfinder.pathLength(context.gameMap, parcelPosition, finalDeliveryCell, context.crates);
                if (deliveryDistance === undefined) {
                    continue;
                }
                if (shortestDeliveryDistance === undefined
                    || deliveryDistance < shortestDeliveryDistance) {
                    shortestDeliveryDistance = deliveryDistance;
                }
            }
            if (shortestDeliveryDistance === undefined) {
                continue;
            }
            const finalDeliveryTime = ((firstDeliveryDistance
                + pickupDistance
                + shortestDeliveryDistance) * context.movementDuration) / 1000;
            bestContinuationReward = Math.max(bestContinuationReward, Math.max(0, parcel.reward - finalDeliveryTime));
        }
        return carriedReward + bestContinuationReward;
    }
    buildActions(context) {
        const actions = context.pathfinder.findPath(context.gameMap, context.agentPosition, this.deliveryCell, context.crates);
        actions.push(context.actionFactory.drop(context.agentId));
        return actions;
    }
    shouldInterrupt(context) {
        let freeParcelCount = 0;
        for (const parcel of context.parcels.values()) {
            if (parcel.carriedBy) {
                continue;
            }
            freeParcelCount += 1;
            if (!this.knownFreeParcelIds.has(parcel.id)) {
                return true;
            }
        }
        return freeParcelCount !== this.knownFreeParcelIds.size;
    }
    log(context) {
        console.log(`\x1b[36mDelivering packet at (${this.deliveryCell.x};${this.deliveryCell.y}) - Score: ${this.score(context)}\x1b[0m`);
    }
}
//# sourceMappingURL=intentions.js.map