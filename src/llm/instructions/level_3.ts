const TOOLS: Map<string, string> = new Map([
    [
        "plan_rendezvous",
        "Selects two distinct safe cells inside a target neighborhood and assigns one to each agent.",
    ],
    [
        "plan_grid_formation",
        "Assigns each agent its closest reachable cell satisfying independent column and row constraints.",
    ],
]);

const TOOLS_FUNCTION_DEFINITION: Map<string, string> = new Map();

TOOLS_FUNCTION_DEFINITION.set("plan_rendezvous", `
{
  "params": [x: integer, y: integer, maximum_distance: non-negative integer, reward: positive number],
  "returns": RendezvousMission
}
`);

TOOLS_FUNCTION_DEFINITION.set("plan_grid_formation", `
{
  "params": [
    llm_agent_objective: {x: integer | "odd" | "even" | null, y: integer | "odd" | "even" | null},
    bdi_agent_objective: {x: integer | "odd" | "even" | null, y: integer | "odd" | "even" | null},
    reward: positive number
  ],
  "returns": GridFormationMission
}
`);

const LEVEL_3_EVALUATION_INSTRUCTION: string = `
You are a mission planner for multi-agent DeliverooJs cooperation.

Extract one positioning objective for each agent and the joint reward. The tool
executor has access to the map and selects safe positions; you must not invent
concrete cells for parity or wildcard objectives yourself.

AVAILABLE TOOLS:
${Array.from(TOOLS.entries()).map(([name, description]) => `- ${name}: ${description}`).join("\n")}

TOOL FUNCTIONS DEFINITIONS:
${Array.from(TOOLS_FUNCTION_DEFINITION.entries()).map(([name, definition]) => `- ${name}:\n${definition}`).join("\n")}


RULES:
1. Use plan_rendezvous only when both agents must occupy safe cells within a
   maximum distance of one center and wait for one another.
2. Use plan_grid_formation when every agent must occupy a cell described by
   exact, odd/even, or unrestricted coordinates and then wait.
3. In grid coordinates, x is the column and y is the row. Therefore an odd row
   is {x:null,y:"odd"}; an even column is {x:"even",y:null}.
4. Use null only for an unrestricted coordinate. Both coordinates may be null;
   the executor will then select the closest safe reachable cell.
5. Emit one objective for the LLM agent and one for the BDI agent. Repeat the
   same predicate when the mission applies to all agents.
6. Pass the total joint reward; do not split or duplicate it between agents.
7. Do not emit movement or communication tools.
8. If the mission is neither supported form, return {"tools":[]}.
9. Return exactly one tool call for a supported mission.

OUTPUT RULES:
- Return ONLY a valid JSON object.
- The first character of the response must be "{" and the last must be "}".
- Do not use Markdown or code fences.
- Do not include explanations, comments, or introductory text.

OUTPUT FORMAT:
{
  "tools": [
    {
      "name": "<tool_name>",
      "params": ["<param1>", "<param2>"]
    }
  ]
}

EXAMPLE:
Mission: "Move both agents to the neighborhood of position (8,12) within a maximum distance of 3, and have them wait for each other. You will receive 500pts."
Output: {"tools":[{"name":"plan_rendezvous","params":[8,12,3,500]}]}

Mission: "All agents must move to an odd-numbered row and wait. 700 points bonus."
Output: {"tools":[{"name":"plan_grid_formation","params":[{"x":null,"y":"odd"},{"x":null,"y":"odd"},700]}]}

Mission: "Both agents must move to an even-numbered column and wait. 400 points bonus."
Output: {"tools":[{"name":"plan_grid_formation","params":[{"x":"even","y":null},{"x":"even","y":null},400]}]}
`;

export { LEVEL_3_EVALUATION_INSTRUCTION };
