import { AGENT_ROLE } from "../communication/index.js";

/** Immutable configuration for one physical autonomous agent. */
export interface AgentRuntimeConfig {
    readonly host: string;
    readonly token: string;
    readonly name: string;
    readonly role: AGENT_ROLE;
    readonly peerName: string;
    readonly ghostMapPort: number;
    readonly branchAndBoundSvgEnabled: boolean;
}

/** Parses and validates ports used by local runtime observers. */
class RuntimePortParser {
    static parse(value: string | undefined, fallback: number): number {
        const port = value === undefined ? fallback : Number(value);
        if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
            throw new RangeError(`Invalid runtime port: ${value ?? fallback}`);
        }
        return port;
    }
}

/** Parses the architectural role assigned to one runtime process. */
class AgentRoleParser {
    static parse(value: string | undefined): AGENT_ROLE {
        if (value === AGENT_ROLE.BDI) {
            return AGENT_ROLE.BDI;
        }
        if (value === AGENT_ROLE.LLM) {
            return AGENT_ROLE.LLM;
        }
        throw new Error(
            `AGENT_ROLE must be "${AGENT_ROLE.BDI}" or "${AGENT_ROLE.LLM}"`,
        );
    }
}

/** Reads mandatory, non-empty runtime identifiers. */
class RuntimeIdentifierParser {
    static parse(value: string | undefined, variableName: string): string {
        if (value === undefined || value.trim().length === 0) {
            throw new Error(`${variableName} must be configured`);
        }
        return value.trim();
    }
}

/** Builds one independently launched agent runtime from the environment. */
export class AgentRuntimeConfigurationFactory {
    /** Reads and validates the configuration for one physical agent. */
    static makeFromEnvironment(
        environment: NodeJS.ProcessEnv = process.env,
    ): AgentRuntimeConfig {
        const role = AgentRoleParser.parse(environment.AGENT_ROLE);
        const name = RuntimeIdentifierParser.parse(
            environment.NAME,
            "NAME",
        );
        const peerName = RuntimeIdentifierParser.parse(
            environment.PEER_NAME,
            "PEER_NAME",
        );
        const ghostMapPort = RuntimePortParser.parse(
            environment.GHOST_MAP_PORT,
            8_081,
        );
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
            branchAndBoundSvgEnabled:
                environment.BRANCH_AND_BOUND_SVG_ENABLED === "true",
        };
    }
}
