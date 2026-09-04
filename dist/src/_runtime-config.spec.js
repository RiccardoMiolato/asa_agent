import { strict as assert } from "node:assert";
import test from "node:test";
import { AGENT_ROLE } from "./communication/index.js";
import { AgentRuntimeConfigurationFactory } from "./runtime/index.js";
/** Typed environment fixtures for independently launched runtime tests. */
class RuntimeEnvironmentFixture {
    static make(overrides = {}) {
        return {
            HOST: "http://game.test",
            TOKEN: "agent-token",
            NAME: "local-agent",
            AGENT_ROLE: AGENT_ROLE.BDI,
            PEER_NAME: "peer-agent",
            GHOST_MAP_PORT: "9001",
            ...overrides,
        };
    }
}
test("one environment creates exactly one BDI runtime configuration", () => {
    const config = AgentRuntimeConfigurationFactory.makeFromEnvironment(RuntimeEnvironmentFixture.make());
    assert.equal(config.host, "http://game.test");
    assert.equal(config.token, "agent-token");
    assert.equal(config.name, "local-agent");
    assert.equal(config.role, AGENT_ROLE.BDI);
    assert.equal(config.peerName, "peer-agent");
    assert.equal(config.ghostMapPort, 9001);
});
test("the independently launched LLM process selects the LLM role", () => {
    const config = AgentRuntimeConfigurationFactory.makeFromEnvironment(RuntimeEnvironmentFixture.make({
        NAME: "llm-agent",
        AGENT_ROLE: AGENT_ROLE.LLM,
        PEER_NAME: "bdi-agent",
    }));
    assert.equal(config.role, AGENT_ROLE.LLM);
    assert.equal(config.name, "llm-agent");
    assert.equal(config.peerName, "bdi-agent");
});
test("runtime configuration requires an explicit valid role", () => {
    assert.throws(() => {
        AgentRuntimeConfigurationFactory.makeFromEnvironment(RuntimeEnvironmentFixture.make({ AGENT_ROLE: "coordinator" }));
    }, /AGENT_ROLE must be/);
});
test("runtime configuration rejects a peer with the local name", () => {
    assert.throws(() => {
        AgentRuntimeConfigurationFactory.makeFromEnvironment(RuntimeEnvironmentFixture.make({ PEER_NAME: "local-agent" }));
    }, /require distinct names/);
});
//# sourceMappingURL=_runtime-config.spec.js.map