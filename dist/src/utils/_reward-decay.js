/** Converts predicted action durations into parcel reward decay. */
export class RewardDecayEstimator {
    /** Estimates the wall-clock duration of movement and non-movement actions. */
    static actionSequenceDurationMilliseconds(movementCount, nonMovementActionCount, movementDuration, frameDuration) {
        return (movementCount * 2 + nonMovementActionCount) * movementDuration
            + movementCount * frameDuration;
    }
    /** Predicts the integer reward remaining after the supplied elapsed time. */
    static remainingReward(reward, elapsedMilliseconds, rewardDecayInterval, millisecondsUntilNextDecay) {
        if (rewardDecayInterval === undefined) {
            return reward;
        }
        const decayTicks = RewardDecayEstimator.decayTicks(elapsedMilliseconds, rewardDecayInterval, millisecondsUntilNextDecay);
        return Math.max(0, reward - decayTicks);
    }
    /** Earliest elapsed time at which a reward is at or below a threshold. */
    static elapsedMillisecondsUntilRewardAtMost(reward, threshold, rewardDecayInterval, millisecondsUntilNextDecay) {
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
        return Math.max(0, (requiredDecayTicks - 0.5) * rewardDecayInterval);
    }
    static decayTicks(elapsedMilliseconds, rewardDecayInterval, millisecondsUntilNextDecay) {
        if (millisecondsUntilNextDecay === undefined) {
            return Math.round(elapsedMilliseconds / rewardDecayInterval);
        }
        if (elapsedMilliseconds < millisecondsUntilNextDecay) {
            return 0;
        }
        return 1 + Math.floor((elapsedMilliseconds - millisecondsUntilNextDecay)
            / rewardDecayInterval);
    }
}
//# sourceMappingURL=_reward-decay.js.map