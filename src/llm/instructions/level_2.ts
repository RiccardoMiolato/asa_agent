const TOOLS: Map<string, string> = new Map([
  ["stack_constraint", "Handles constraints relative to stack capacity when delivering parcels."],
  ["delivery_constraint", "Handles constraints relative to delivery points."],
  ["parcel_constraint", "Handles constraints relative to parcels score when delivering."],
  ["avoid_cell", "Handles penalty assigned to agents for walking over a specific cell."],
]);

const TOOLS_FUNCTION_DEFINITION: Map<string, string> = new Map();

TOOLS_FUNCTION_DEFINITION.set("stack_constraint", `
{
  "params": [stack_size: positive integer, multiplier: non-negative number],
  "returns": Constraint
}
`);

TOOLS_FUNCTION_DEFINITION.set("delivery_constraint", `
{
    "params": [x: number, y: number, type: "points" | "multiplier", value: number],
    "returns": Constraint
}
`);

TOOLS_FUNCTION_DEFINITION.set("parcel_constraint", `
{
    "params": [score: number, deliverLower: boolean],
    "returns": Constraint
}
`);

TOOLS_FUNCTION_DEFINITION.set("avoid_cell", `
{
    "params": [x: number, y: number, penalty: number],
    "returns": Constraint
}
`);


const LEVEL_2_EVALUATION_INSTRUCTION: string = `
You are a mission evaluator for a DeliverooJs autonomous agent.

Given a LEVEL 2 mission (one that modifies gameplay strategy, rewards, or constraints),
identify the tools needed to accomplish it.

AVAILABLE TOOLS:
${Array.from(TOOLS.entries()).map(([name, description]) => `- ${name}: ${description}`).join("\n")}

TOOL FUNCTIONS DEFINITIONS:
${Array.from(TOOLS_FUNCTION_DEFINITION.entries()).map(([name, definition]) => `- ${name}:\n${definition}`).join("\n")}

LEVEL 2 MISSION CHARACTERISTICS:
- Introduces constraints or effects affecting subsequent gameplay
- Modifies delivery rewards or movement restrictions
- Requires adapting the agent's decision-making strategy
- May affect parcel prioritization or route planning

GUIDING RULES:
1. Constraint-aware tools must monitor the imposed limitation continuously
2. Reward modification tools should track and recalculate delivery values
3. Movement restriction tools need path validation before execution
4. Strategy adaptation tools must update intention scoring logic
5. Fallback tools ensure mission completion if primary strategy fails
6. Persistent rules must produce one tool call for every coordinate they affect
7. Use "multiplier" for relative rewards such as 5x, double, half, 0.3x, or zero reward
8. Use "points" only for a fixed signed number of points

OUTPUT:
Return ONLY a valid JSON object.
Your entire response must begin with "{" and end with "}".
Do not include markdown, code fences, explanations, comments, or additional text.

The output must have this structure:
{
  "tools": [
    {
      "name": "<tool_name>",
      "params": [...]
    }
  ]
}

EXAMPLES:
Mission: "Deliver stacks of exactly 3 parcels at a time to double the reward"
Output: {
  "tools": [{
    "name": "stack_constraint",
    "params": [3, 2]
  }]
}

Mission: "Deliver stacks of exactly 5 parcels at a time to get 0.3 of the standard reward"
Output: {
  "tools": [{
    "name": "stack_constraint",
    "params": [5, 0.3]
  }]
}

Mission: "Every time you deliver in (1,5) or (3,4) you get 5x pts than in a regular delivery tile"
Output: {
  "tools": [{
    "name": "delivery_constraint",
    "params": [1, 5, "multiplier", 5]
  },
  {
    "name": "delivery_constraint",
    "params": [3, 4, "multiplier", 5]
  }]
}

Mission: "Every time you deliver in (9,20) you get 0 pts"
Output: {
  "tools": [{
    "name": "delivery_constraint",
    "params": [9, 20, "multiplier", 0]
  }]
}

Mission: "If you deliver parcels with a score higher than 10, you get no reward."
Output: {
  "tools": [{
    "name": "parcel_constraint",
    "params": [10, true]
  }]
}

Mission: "Do not go through tile (10,2) otherwise you lose 50pts."
Output: {
  "tools": [{
    "name": "avoid_cell",
    "params": [10, 2, -50]
  }]
}

`;

export { LEVEL_2_EVALUATION_INSTRUCTION };
