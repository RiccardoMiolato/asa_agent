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

    /** Earliest elapsed time at which a reward is at or below a threshold. */
    static elapsedMillisecondsUntilRewardAtMost(
        reward: number,
        threshold: number,
        rewardDecayInterval: number | undefined,
        millisecondsUntilNextDecay: number | undefined,
    ): number | undefined {
        if (reward <= threshold) {
            return 0;
        }
        if (rewardDecayInterval === undefined) {
            return undefined;
        }

        const requiredDecayTicks = Math.ceil(reward - threshold);
        if (millisecondsUntilNextDecay !== undefined) {
            return millisecondsUntilNextDecay
                + (requiredDecayTicks - 1) * rewardDecayInterval;
        }

        // remainingReward() uses Math.round() without an observed next tick.
        return Math.max(
            0,
            (requiredDecayTicks - 0.5) * rewardDecayInterval,
        );
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
