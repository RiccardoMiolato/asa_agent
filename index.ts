import {
    AgentRuntimeConfigurationFactory,
    AgentRuntimeFactory,
} from "./src/runtime/index.js";

const runtimeConfig = AgentRuntimeConfigurationFactory.makeFromEnvironment();
AgentRuntimeFactory.make(runtimeConfig).start();
