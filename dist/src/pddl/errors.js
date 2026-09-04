/** Base error for failures while invoking the local PDDL planner. */
export class PDDLPlannerExecutionError extends Error {
    constructor(message) {
        super(message);
        this.name = "PDDLPlannerExecutionError";
    }
}
/** The local planner exceeded the time available for one navigation request. */
export class PDDLPlannerTimeoutError extends PDDLPlannerExecutionError {
    constructor(timeoutMilliseconds) {
        super(`Fast Downward timed out after ${timeoutMilliseconds} ms`);
        this.name = "PDDLPlannerTimeoutError";
    }
}
//# sourceMappingURL=errors.js.map