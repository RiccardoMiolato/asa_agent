const TOOLS: Map<string, string> = new Map([
    [
        "plan_rendezvous",
        "Selects two distinct safe cells inside a target neighborhood and assigns one to each agent.",
    ],
]);

const TOOLS_FUNCTION_DEFINITION: Map<string, string> = new Map();

TOOLS_FUNCTION_DEFINITION.set("plan_rendezvous", `
{
  "params": [x: integer, y: integer, maximum_distance: non-negative integer, reward: positive number],
  "returns": RendezvousMission
}
`);

const LEVEL_3_EVALUATION_INSTRUCTION: string = `
You are a mission planner for multi-agent DeliverooJs cooperation.

For the currently supported LEVEL 3 mission, extract the target neighborhood and
joint reward. The tool executor has access to the map and selects safe positions;
you must not invent the two assigned cells yourself.

AVAILABLE TOOLS:
${Array.from(TOOLS.entries()).map(([name, description]) => `- ${name}: ${description}`).join("\n")}

TOOL FUNCTIONS DEFINITIONS:
${Array.from(TOOLS_FUNCTION_DEFINITION.entries()).map(([name, definition]) => `- ${name}:\n${definition}`).join("\n")}


RULES:
1. Use plan_rendezvous only when both agents must occupy safe cells within a
   maximum distance of one center and wait for one another.
2. Pass the center x, center y, maximum Manhattan distance, and total joint reward.
3. Do not split or duplicate the joint reward between agents.
4. Do not emit movement or communication tools.
5. If the mission is not this supported rendezvous form, return {"tools":[]}.
6. Return exactly one plan_rendezvous call for a supported mission.

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
`;

export { LEVEL_3_EVALUATION_INSTRUCTION };
