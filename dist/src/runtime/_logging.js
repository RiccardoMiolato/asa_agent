/** Logging contract for runtime connection and lifecycle events. */
export class BaseAgentRuntimeLogger {
}
/** Human-readable terminal logger for runtime lifecycle events. */
export class ConsoleAgentRuntimeLogger extends BaseAgentRuntimeLogger {
    log(event) {
        switch (event.event) {
            case "connected":
                console.log(`Agent runtime ${event.agentName} connected`);
                return;
            case "ghost-map-ready":
                console.log(`Ghost map for ${event.agentName} available at http://localhost:${event.port}`);
                return;
            case "ghost-map-failed":
                console.error(`Could not start ghost map for ${event.agentName}`, event.error);
                return;
            case "runtime-crashed":
                console.error(`Agent runtime ${event.agentName} crashed`, event.error);
                return;
            case "no-feasible-plan":
                console.error(`No feasible plan exists for ${event.agentName}`);
        }
    }
}
//# sourceMappingURL=_logging.js.map