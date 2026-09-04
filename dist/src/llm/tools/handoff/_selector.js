import { RewardDecayEstimator } from "../../../utils/_reward-decay.js";
import { Position } from "../../../utils/position.js";
/** Contract for independently replaceable joint-route selection policies. */
export class BaseParcelHandoffCandidateSelector {
}
/** Selects the most balanced route among parcels predicted to survive delivery. */
export class BalancedSurvivableParcelHandoffCandidateSelector extends BaseParcelHandoffCandidateSelector {
    select(context) {
        const candidates = [];
        for (const parcel of context.planning.parcels.values()) {
            candidates.push(...this.candidatesForParcel(context, parcel));
        }
        candidates.sort((first, second) => first.pathImbalanceMilliseconds
            - second.pathImbalanceMilliseconds
            || first.estimatedCompletionMilliseconds
                - second.estimatedCompletionMilliseconds
            || second.estimatedRewardAtDelivery
                - first.estimatedRewardAtDelivery
            || first.parcelId.localeCompare(second.parcelId));
        return candidates[0];
    }
    candidatesForParcel(context, parcel) {
        if (parcel.carriedBy !== undefined || parcel.reward <= 0) {
            return [];
        }
        const planning = context.planning;
        const handoffCell = new Position(parcel.x, parcel.y);
        if (!planning.gameMap.isValidCell(handoffCell)
            || planning.gameMap.getCellValue(handoffCell) === "2") {
            return [];
        }
        const delivery = this.closestDelivery(context, handoffCell);
        if (!delivery) {
            return [];
        }
        const candidates = [];
        const neighbors = planning.gameMap.getNeighborsOf(handoffCell);
        for (const staging of neighbors) {
            const cratesWithHandoffBlocked = this.withBlockedCell(planning.crates, handoffCell);
            const bdiDistance = planning.pathfinder.pathLength(planning.gameMap, context.bdiAgentPosition, staging.coord, cratesWithHandoffBlocked);
            if (bdiDistance === undefined) {
                continue;
            }
            const cratesWithStagingBlocked = this.withBlockedCell(planning.crates, staging.coord);
            const llmDistance = planning.pathfinder.pathLength(planning.gameMap, planning.agentPosition, handoffCell, cratesWithStagingBlocked);
            if (llmDistance === undefined) {
                continue;
            }
            for (const escape of neighbors) {
                if (escape.coord.isEqual(staging.coord)) {
                    continue;
                }
                if (this.hasCrateAt(planning, escape.coord)) {
                    continue;
                }
                const escapeDistance = planning.pathfinder.pathLength(planning.gameMap, handoffCell, escape.coord, planning.crates);
                const handoffEntryDistance = planning.pathfinder.pathLength(planning.gameMap, staging.coord, handoffCell, planning.crates);
                if (escapeDistance !== 1 || handoffEntryDistance !== 1) {
                    continue;
                }
                const candidate = this.makeCandidate(context, parcel, handoffCell, staging.coord, escape.coord, delivery.cell, llmDistance, bdiDistance, delivery.distance);
                if (candidate.estimatedRewardAtDelivery > 0) {
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }
    closestDelivery(context, handoffCell) {
        let selected;
        for (const cell of context.planning.deliveringCells) {
            const distance = context.planning.pathfinder.pathLength(context.planning.gameMap, handoffCell, cell, context.planning.crates);
            if (distance !== undefined
                && (selected === undefined || distance < selected.distance)) {
                selected = { cell, distance };
            }
        }
        return selected;
    }
    makeCandidate(context, parcel, handoffCell, stagingCell, escapeCell, deliveryCell, llmDistance, bdiDistance, deliveryDistance) {
        const planning = context.planning;
        const llmWork = RewardDecayEstimator.actionSequenceDurationMilliseconds(llmDistance + 1, BalancedSurvivableParcelHandoffCandidateSelector
            .PICKER_ACTION_COUNT, planning.movementDuration, planning.frameDuration);
        const bdiWork = RewardDecayEstimator.actionSequenceDurationMilliseconds(bdiDistance + 1 + deliveryDistance, BalancedSurvivableParcelHandoffCandidateSelector
            .RECEIVER_ACTION_COUNT, planning.movementDuration, planning.frameDuration);
        const pickerReady = RewardDecayEstimator.actionSequenceDurationMilliseconds(llmDistance, 1, planning.movementDuration, planning.frameDuration);
        const receiverReady = RewardDecayEstimator.actionSequenceDurationMilliseconds(bdiDistance, 0, planning.movementDuration, planning.frameDuration);
        const handoffDuration = RewardDecayEstimator.actionSequenceDurationMilliseconds(BalancedSurvivableParcelHandoffCandidateSelector
            .HANDOFF_MOVEMENT_COUNT, BalancedSurvivableParcelHandoffCandidateSelector
            .HANDOFF_ACTION_COUNT, planning.movementDuration, planning.frameDuration);
        const deliveryDuration = RewardDecayEstimator.actionSequenceDurationMilliseconds(deliveryDistance, 1, planning.movementDuration, planning.frameDuration);
        const safetyMargin = planning.rewardDecayInterval === undefined
            ? 0
            : planning.rewardDecayInterval
                * BalancedSurvivableParcelHandoffCandidateSelector
                    .SAFETY_DECAY_TICKS;
        const estimatedCompletionMilliseconds = Math.max(pickerReady, receiverReady) + handoffDuration + deliveryDuration + safetyMargin;
        return {
            parcelId: parcel.id,
            parcelReward: parcel.reward,
            handoffCell: new Position(handoffCell.x, handoffCell.y),
            stagingCell: new Position(stagingCell.x, stagingCell.y),
            escapeCell: new Position(escapeCell.x, escapeCell.y),
            deliveryCell: new Position(deliveryCell.x, deliveryCell.y),
            llmMovementSteps: llmDistance + 1,
            bdiMovementSteps: bdiDistance + 1 + deliveryDistance,
            pathImbalanceMilliseconds: Math.abs(llmWork - bdiWork),
            estimatedCompletionMilliseconds,
            estimatedRewardAtDelivery: RewardDecayEstimator.remainingReward(parcel.reward, estimatedCompletionMilliseconds, planning.rewardDecayInterval, planning.millisecondsUntilNextRewardDecay),
        };
    }
    hasCrateAt(planning, position) {
        return [...planning.crates.values()].some((crate) => crate.isEqual(position));
    }
    withBlockedCell(crates, position) {
        const blocked = new Map(crates);
        blocked.set(`handoff-reservation:${position.x},${position.y}`, position);
        return blocked;
    }
}
BalancedSurvivableParcelHandoffCandidateSelector.PICKER_ACTION_COUNT = 2;
BalancedSurvivableParcelHandoffCandidateSelector.RECEIVER_ACTION_COUNT = 2;
BalancedSurvivableParcelHandoffCandidateSelector.HANDOFF_MOVEMENT_COUNT = 2;
BalancedSurvivableParcelHandoffCandidateSelector.HANDOFF_ACTION_COUNT = 2;
BalancedSurvivableParcelHandoffCandidateSelector.SAFETY_DECAY_TICKS = 2;
//# sourceMappingURL=_selector.js.map