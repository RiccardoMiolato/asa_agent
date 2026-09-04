import type { Parcel } from "../../../bdi/beliefs.js";
import type { PlanningContext } from "../../../planning.js";
import { RewardDecayEstimator } from "../../../utils/_reward-decay.js";
import { Position } from "../../../utils/position.js";

/** Immutable plan for transferring one survivable parcel between two agents. */
export interface ParcelHandoffCandidate {
    readonly parcelId: string;
    readonly parcelReward: number;
    readonly handoffCell: Position;
    readonly stagingCell: Position;
    readonly escapeCell: Position;
    readonly deliveryCell: Position;
    readonly llmMovementSteps: number;
    readonly bdiMovementSteps: number;
    readonly pathImbalanceMilliseconds: number;
    readonly estimatedCompletionMilliseconds: number;
    readonly estimatedRewardAtDelivery: number;
}

/** Inputs required to compare a local parcel route with the peer's route. */
export interface ParcelHandoffSelectionContext {
    readonly planning: PlanningContext;
    readonly bdiAgentPosition: Position;
}

/** Contract for independently replaceable joint-route selection policies. */
export abstract class BaseParcelHandoffCandidateSelector {
    abstract select(
        context: ParcelHandoffSelectionContext,
    ): ParcelHandoffCandidate | undefined;
}

/** Selects the most balanced route among parcels predicted to survive delivery. */
export class BalancedSurvivableParcelHandoffCandidateSelector
    extends BaseParcelHandoffCandidateSelector {
    private static readonly PICKER_ACTION_COUNT = 2;
    private static readonly RECEIVER_ACTION_COUNT = 2;
    private static readonly HANDOFF_MOVEMENT_COUNT = 2;
    private static readonly HANDOFF_ACTION_COUNT = 2;
    private static readonly SAFETY_DECAY_TICKS = 2;

    select(
        context: ParcelHandoffSelectionContext,
    ): ParcelHandoffCandidate | undefined {
        const candidates: ParcelHandoffCandidate[] = [];
        for (const parcel of context.planning.parcels.values()) {
            candidates.push(...this.candidatesForParcel(context, parcel));
        }
        candidates.sort(
            (
                first: ParcelHandoffCandidate,
                second: ParcelHandoffCandidate,
            ): number =>
                first.pathImbalanceMilliseconds
                    - second.pathImbalanceMilliseconds
                || first.estimatedCompletionMilliseconds
                    - second.estimatedCompletionMilliseconds
                || second.estimatedRewardAtDelivery
                    - first.estimatedRewardAtDelivery
                || first.parcelId.localeCompare(second.parcelId),
        );
        return candidates[0];
    }

    private candidatesForParcel(
        context: ParcelHandoffSelectionContext,
        parcel: Parcel,
    ): readonly ParcelHandoffCandidate[] {
        if (parcel.carriedBy !== undefined || parcel.reward <= 0) {
            return [];
        }
        const planning = context.planning;
        const handoffCell = new Position(parcel.x, parcel.y);
        if (
            !planning.gameMap.isValidCell(handoffCell)
            || planning.gameMap.getCellValue(handoffCell) === "2"
        ) {
            return [];
        }

        const delivery = this.closestDelivery(context, handoffCell);
        if (!delivery) {
            return [];
        }

        const candidates: ParcelHandoffCandidate[] = [];
        const neighbors = planning.gameMap.getNeighborsOf(handoffCell);
        for (const staging of neighbors) {
            const cratesWithHandoffBlocked = this.withBlockedCell(
                planning.crates,
                handoffCell,
            );
            const bdiDistance = planning.pathfinder.pathLength(
                planning.gameMap,
                context.bdiAgentPosition,
                staging.coord,
                cratesWithHandoffBlocked,
            );
            if (bdiDistance === undefined) {
                continue;
            }
            const cratesWithStagingBlocked = this.withBlockedCell(
                planning.crates,
                staging.coord,
            );
            const llmDistance = planning.pathfinder.pathLength(
                planning.gameMap,
                planning.agentPosition,
                handoffCell,
                cratesWithStagingBlocked,
            );
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
                const escapeDistance = planning.pathfinder.pathLength(
                    planning.gameMap,
                    handoffCell,
                    escape.coord,
                    planning.crates,
                );
                const handoffEntryDistance = planning.pathfinder.pathLength(
                    planning.gameMap,
                    staging.coord,
                    handoffCell,
                    planning.crates,
                );
                if (escapeDistance !== 1 || handoffEntryDistance !== 1) {
                    continue;
                }
                const candidate = this.makeCandidate(
                    context,
                    parcel,
                    handoffCell,
                    staging.coord,
                    escape.coord,
                    delivery.cell,
                    llmDistance,
                    bdiDistance,
                    delivery.distance,
                );
                if (candidate.estimatedRewardAtDelivery > 0) {
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }

    private closestDelivery(
        context: ParcelHandoffSelectionContext,
        handoffCell: Position,
    ): { readonly cell: Position; readonly distance: number } | undefined {
        let selected:
            { readonly cell: Position; readonly distance: number } | undefined;
        for (const cell of context.planning.deliveringCells) {
            const distance = context.planning.pathfinder.pathLength(
                context.planning.gameMap,
                handoffCell,
                cell,
                context.planning.crates,
            );
            if (
                distance !== undefined
                && (selected === undefined || distance < selected.distance)
            ) {
                selected = { cell, distance };
            }
        }
        return selected;
    }

    private makeCandidate(
        context: ParcelHandoffSelectionContext,
        parcel: Parcel,
        handoffCell: Position,
        stagingCell: Position,
        escapeCell: Position,
        deliveryCell: Position,
        llmDistance: number,
        bdiDistance: number,
        deliveryDistance: number,
    ): ParcelHandoffCandidate {
        const planning = context.planning;
        const llmWork = RewardDecayEstimator.actionSequenceDurationMilliseconds(
            llmDistance + 1,
            BalancedSurvivableParcelHandoffCandidateSelector
                .PICKER_ACTION_COUNT,
            planning.movementDuration,
            planning.frameDuration,
        );
        const bdiWork = RewardDecayEstimator.actionSequenceDurationMilliseconds(
            bdiDistance + 1 + deliveryDistance,
            BalancedSurvivableParcelHandoffCandidateSelector
                .RECEIVER_ACTION_COUNT,
            planning.movementDuration,
            planning.frameDuration,
        );
        const pickerReady =
            RewardDecayEstimator.actionSequenceDurationMilliseconds(
                llmDistance,
                1,
                planning.movementDuration,
                planning.frameDuration,
            );
        const receiverReady =
            RewardDecayEstimator.actionSequenceDurationMilliseconds(
                bdiDistance,
                0,
                planning.movementDuration,
                planning.frameDuration,
            );
        const handoffDuration =
            RewardDecayEstimator.actionSequenceDurationMilliseconds(
                BalancedSurvivableParcelHandoffCandidateSelector
                    .HANDOFF_MOVEMENT_COUNT,
                BalancedSurvivableParcelHandoffCandidateSelector
                    .HANDOFF_ACTION_COUNT,
                planning.movementDuration,
                planning.frameDuration,
            );
        const deliveryDuration =
            RewardDecayEstimator.actionSequenceDurationMilliseconds(
                deliveryDistance,
                1,
                planning.movementDuration,
                planning.frameDuration,
            );
        const safetyMargin = planning.rewardDecayInterval === undefined
            ? 0
            : planning.rewardDecayInterval
                * BalancedSurvivableParcelHandoffCandidateSelector
                    .SAFETY_DECAY_TICKS;
        const estimatedCompletionMilliseconds = Math.max(
            pickerReady,
            receiverReady,
        ) + handoffDuration + deliveryDuration + safetyMargin;

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
            estimatedRewardAtDelivery: RewardDecayEstimator.remainingReward(
                parcel.reward,
                estimatedCompletionMilliseconds,
                planning.rewardDecayInterval,
                planning.millisecondsUntilNextRewardDecay,
            ),
        };
    }

    private hasCrateAt(
        planning: PlanningContext,
        position: Position,
    ): boolean {
        return [...planning.crates.values()].some(
            (crate: Position): boolean => crate.isEqual(position),
        );
    }

    private withBlockedCell(
        crates: ReadonlyMap<string, Position>,
        position: Position,
    ): ReadonlyMap<string, Position> {
        const blocked = new Map<string, Position>(crates);
        blocked.set(
            `handoff-reservation:${position.x},${position.y}`,
            position,
        );
        return blocked;
    }
}
