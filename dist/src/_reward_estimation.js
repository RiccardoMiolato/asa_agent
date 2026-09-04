/** Estimates discrete parcel decay using the server configuration and agent loop. */
export class RewardEstimator {
    static decayIntervalMilliseconds(event, frameDuration) {
        switch (event) {
            case "frame":
                return frameDuration;
            case "1s":
                return 1000;
            case "2s":
                return 2000;
            case "5s":
                return 5000;
            case "10s":
                return 10000;
            case "1m":
                return 60000;
            case "1h":
                return 3600000;
            case "infinite":
                return undefined;
        }
    }
    /**
     * Estimates the total remaining reward for parcels delivered by a plan.
     *
     * Every action has a client-side wait. Every movement additionally waits for
     * the server movement and potentially for up to one server frame. The exact
     * decay-clock phase is not exposed, so the result is an honest lower/upper bound.
     */
    static estimateTotalReward(rewards, movementCount, nonMovementActionCount, interPlanWaitCount, movementDuration, frameDuration, decayInterval) {
        if (decayInterval === undefined) {
            const totalReward = rewards.reduce((total, reward) => total + reward, 0);
            return {
                minimumReward: totalReward,
                maximumReward: totalReward,
                minimumDecayTicks: 0,
                maximumDecayTicks: 0,
            };
        }
        const clientWaitDuration = (movementCount + nonMovementActionCount + interPlanWaitCount) * movementDuration;
        const minimumExecutionDuration = clientWaitDuration
            + movementCount * movementDuration;
        const maximumExecutionDuration = minimumExecutionDuration
            + movementCount * frameDuration;
        const minimumDecayTicks = Math.floor(minimumExecutionDuration / decayInterval);
        const maximumDecayTicks = Math.ceil(maximumExecutionDuration / decayInterval);
        return {
            minimumReward: RewardEstimator.rewardAfterTicks(rewards, maximumDecayTicks),
            maximumReward: RewardEstimator.rewardAfterTicks(rewards, minimumDecayTicks),
            minimumDecayTicks,
            maximumDecayTicks,
        };
    }
    static rewardAfterTicks(rewards, ticks) {
        return rewards.reduce((total, reward) => total + Math.max(0, reward - ticks), 0);
    }
}
//# sourceMappingURL=_reward_estimation.js.map