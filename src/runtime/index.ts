/**
 * Agent runtime — composition root for one autonomous physical agent.
 *
 * Directory structure:
 * ├── _config.ts   # Immutable runtime configuration
 * ├── _factory.ts  # Dependency construction for one runtime
 * ├── _logging.ts  # Runtime lifecycle logging contracts
 * └── _runtime.ts  # Socket event lifecycle and agent execution
 */

export {
    type AgentRuntimeConfig,
    AgentRuntimeConfigurationFactory,
} from "./_config.js";
export { AgentRuntimeFactory } from "./_factory.js";
export {
    BaseAgentRuntimeLogger,
    ConsoleAgentRuntimeLogger,
    type AgentRuntimeLog,
} from "./_logging.js";
export { AgentRuntime } from "./_runtime.js";
