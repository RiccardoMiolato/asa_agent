import { AGENT_ROLE } from "../communication/index.js";
/** Parses and validates ports used by local runtime observers. */
class RuntimePortParser {
    static parse(value, fallback) {
        const port = value === undefined ? fallback : Number(value);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new RangeError(`Invalid runtime port: ${value ?? fallback}`);
        }
        return port;
    }
}
/** Parses the architectural role assigned to one runtime process. */
class AgentRoleParser {
    static parse(value) {
        if (value === AGENT_ROLE.BDI) {
            return AGENT_ROLE.BDI;
        }
        if (value === AGENT_ROLE.LLM) {
            return AGENT_ROLE.LLM;
        }
        throw new Error(`AGENT_ROLE must be "${AGENT_ROLE.BDI}" or "${AGENT_ROLE.LLM}"`);
    }
}
/** Reads mandatory, non-empty runtime identifiers. */
class RuntimeIdentifierParser {
    static parse(value, variableName) {
        if (value === undefined || value.trim().length === 0) {
            throw new Error(`${variableName} must be configured`);
        }
        return value.trim();
    }
}
/** Builds one independently launched agent runtime from the environment. */
export class AgentRuntimeConfigurationFactory {
    /** Reads and validates the configuration for one physical agent. */
    static makeFromEnvironment(environment = process.env) {
        const role = AgentRoleParser.parse(environment.AGENT_ROLE);
        const name = RuntimeIdentifierParser.parse(environment.NAME, "NAME");
        const peerName = RuntimeIdentifierParser.parse(environment.PEER_NAME, "PEER_NAME");
        const ghostMapPort = RuntimePortParser.parse(environment.GHOST_MAP_PORT, 8081);
        if (name === peerName) {
            throw new Error("The local agent and its peer require distinct names");
        }
        return {
            host: environment.HOST ?? "http://localhost:8080",
            token: environment.TOKEN ?? "",
            name,
            role,
            peerName,
            ghostMapPort,
            branchAndBoundSvgEnabled: environment.BRANCH_AND_BOUND_SVG_ENABLED === "true",
        };
    }
}
//# sourceMappingURL=_config.js.map