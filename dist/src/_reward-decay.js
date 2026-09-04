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