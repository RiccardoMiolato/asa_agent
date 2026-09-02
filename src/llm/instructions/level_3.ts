const TOOLS: Map<string, string> = new Map([
    ["math_eval", "Evaluate arithmetic expressions and return the result."],
    ["move_to", "Tells the agent to go to a specific location in the map."],
    ["drop_at", "Tells the agent to drop parcels in a specific location of the map."],
    ["answer_trivia", "Given a trivia question, return the answer."],
    ["get_agent_position", "Returns the current position of the agent in the map."]
]);

const TOOLS_FUNCTION_DEFINITION: Map<string, string> = new Map();

TOOLS_FUNCTION_DEFINITION.set("math_eval", `
{
  "params": [espression: string],
  "returns": number
}
`);

const LEVEL_3_EVALUATION_INSTRUCTION: string = `
You are a mission coordinator for multi-agent DeliverooJs cooperation.

Given a LEVEL 3 mission (requiring multi-agent coordination), identify the tools
needed for reliable agent synchronization and communication.

AVAILABLE TOOLS:
${Array.from(TOOLS.entries()).map(([name, description]) => `- ${name}: ${description}`).join("\n")}

TOOL FUNCTIONS DEFINITIONS:
${Array.from(TOOLS_FUNCTION_DEFINITION.entries()).map(([name, definition]) => `- ${name}:\n${definition}`).join("\n")}


LEVEL 3 MISSION CHARACTERISTICS:
- Requires coordination between LLM agent (master) and BDI agent (slave)
- Involves synchronized positioning, role allocation, or handoff sequences
- May require waiting, blocking, or sequential task execution
- Success depends on reliable inter-agent communication

GUIDING RULES:
1. Communication tools must enable reliable message passing between agents
2. Synchronization tools ensure agents reach target positions/states together
3. Role allocation tools assign tasks to master or slave based on capability
4. State tracking tools monitor both agent positions and mission progress
5. Timeout tools prevent deadlocks from sensing delays or failed moves

OUTPUT FORMAT (valid JSON only):
{
  "tools": [
    {
      "name": "<tool_name>",
      "params": ["<param1>", "<param2>"]
    }
  ]
}
`;

export { LEVEL_3_EVALUATION_INSTRUCTION };
