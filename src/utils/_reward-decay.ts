/** Converts predicted action durations into parcel reward decay. */
export class RewardDecayEstimator {
    /** Estimates the wall-clock duration of movement and non-movement actions. */
    static actionSequenceDurationMilliseconds(
        movementCount: number,
        nonMovementActionCount: number,
        movementDuration: number,
        frameDuration: number,
    ): number {
        return (movementCount * 2 + nonMovementActionCount) * movementDuration
            + movementCount * frameDuration;
    }

    /** Predicts the integer reward remaining after the supplied elapsed time. */
    static remainingReward(
        reward: number,
        elapsedMilliseconds: number,
        rewardDecayInterval: number | undefined,
        millisecondsUntilNextDecay: number | undefined,
    ): number {
        if (rewardDecayInterval === undefined) {
            return reward;
        }

        const decayTicks = RewardDecayEstimator.decayTicks(
            elapsedMilliseconds,
            rewardDecayInterval,
            millisecondsUntilNextDecay,
        );
        return Math.max(0, reward - decayTicks);
    }

    private static decayTicks(
        elapsedMilliseconds: number,
        rewardDecayInterval: number,
        millisecondsUntilNextDecay: number | undefined,
    ): number {
        if (millisecondsUntilNextDecay === undefined) {
            return Math.round(elapsedMilliseconds / rewardDecayInterval);
        }
        if (elapsedMilliseconds < millisecondsUntilNextDecay) {
            return 0;
        }
        return 1 + Math.floor(
            (elapsedMilliseconds - millisecondsUntilNextDecay)
                / rewardDecayInterval,
        );
    }
}
