const TOOLS: Map<string, string> = new Map([
    ["math_eval", "Evaluate arithmetic expressions and return the result."],
    ["move_to", "Tells the agent to go to a specific location in the map."],
    ["answer_trivia", "Given a trivia question, return the answer."],
]);

const TOOLS_FUNCTION_DEFINITION: Map<string, string> = new Map();

TOOLS_FUNCTION_DEFINITION.set("math_eval", `
{
    "params": [espression: string],
    "returns": number
}
`);

TOOLS_FUNCTION_DEFINITION.set("move_to", `
{
    "params": [x: number, y: number],
    "returns": string
}
`);

TOOLS_FUNCTION_DEFINITION.set("answer_trivia", `
    {
        "params": [question: string],
        "returns": string
    }
    `);

/**
 * This message is passed every time a new message
 * is received, gives general guidelines and rules
 * for processing correctly user messages
 */
const MISSION_CLASSIFICATION_INSTRUCTIONS: string = `
You are a mission classifier for a DeliverooJs autonomous agent.

That means that given a mission message you have to assign it a level from the following options:
- LEVEL 1
- LEVEL 2
- LEVEL 3

LEVELS DEFINITIONS

LEVEL 1:
Refers to atomic missions, which requires standard tools to be completed.
Missions belonging to this level do not alter the state of the game, they simply give
some defined bonus or malus according to the descritption in the mission message.
Another type of mission can be to answer some questions, like simple math calculation
or some trivia question.

Examples:
- Move to coordinate (4,7) and you get +10pts
- Move to x=4*2 y=(1+3)*3 to get -10pts
- Drop a package in the leftmost tile to get 5pt
- Drop a package in the leftmost tile to get -10pt
- What is the capital of Italy?
- Calculate 5*5

LEVEL 2:
Refers to missions that requires the agent to adapt its game strategy in order to
be accomplished. These missions may require additional tools to be accomplished.
Missions belonging to this level introduce constraints or effects that influence how
subsequent gameplay should be performed, such as changing delivery rewards, imposing movement
restrictions, or requiring a particular strategy.

Examples:
- Deliver stacks of exactly 3 parcels at a time to double the reward
- Deliver stacks of exactly 5 parcels at a time to get 0.3 of the standard reward
- Every time you deliver in (x1,y1) or (x2,y2) you get 5x pts than in a regular delivery tile
- Every time you deliver in (x1,y1) you get 0 pts
- If you deliver parcels with a score higher than 10, you get no reward.
- Do not go through tile (x,y) otherwise you lose 50pts.

LEVEL 3:
Refers to multi-agent missions that requires the LLM agent (master) to coordinate
with the BDI agent (slave), in order to accomplish complex tasks.
Complex tasks may refer to moving both agents in a certain position, or zone, may require
to starting a job with one agent and to conclude it with the other (i.e. agent A pick the parcel,
then it passes it to agent B, which can finally delivers it).

Examples:
- Move both agents to the neighborhood of position (x,y) within a maximum distance of 3, and have
them wait for each other. You will receive 500pts.
- If a parcel is initially picked up by one agent and later delivered by the other agent, you will receive a
200 points bonus.
- All agents must move to an odd-numbered row and wait for our message before moving again, as in
a “red light, green light” game. 700 points bonus.

CLASSIFICATION RULES

1. Choose LEVEL 3 if multi-agent coordination is required.
2. Otherwise, choose LEVEL 2 if the mission changes gameplay strategy, future rewards, or movement constraints.
3. Otherwise, choose LEVEL 1.
4. Classify based only on the mission's requirements, not on the size of its reward.
5. A mission does not become Level 2 merely because it involves movement or a reward/malus.
6. If a mission could fit multiple levels, use the highest applicable level.

OUTPUT RULES

Return ONLY valid JSON. Do not include markdown, code fences, or additional text.

Use exactly this structure:
{
"level": <integer: 1, 2, or 3>,
"worth": <boolean: true | false>,
"motivation": "<string: maximum 10 words>"
}

The "worth" field means whether the mission is strategically worth pursuing.
Set it to true when the mission provides a positive strategic benefit/reward and
false when it provides no benefit or imposes a penalty.

The "motivation" must contain at most 10 words and briefly justify the classification
`

const LEVEL_1_EVALUATION_INSTRUCTIONS: string = `
You are an evaluator for atomic missions at the dependency of DeliverooJs Agent.

Given a mission message, your goal is to analyze it and determine how to complete
it using available tools.

Your task is to produce an execution plan for the mission.
You do not have access to the tools and must not assume their results.
The returned tools will be executed by another system.

AVAILABLE TOOLS
${Array.from(TOOLS.entries()).map(([name, description]) => `- ${name}: ${description}`).join("\n")}

TOOL FUNCTIONS DEFINITIONS
${Array.from(TOOLS_FUNCTION_DEFINITION.entries()).map(([name, definition]) => `- ${name}:\n${definition}`).join("\n")}

OUTPUT

Return ONLY valid JSON. Do not include markdown, code fences, explanations,
or additional text.

The output must have this structure:

{
  "tools": [
    {
      "name": "<tool_name>",
      "params": [ ... ]
    }
  ]
}

Rules:

1. Include a tool only when it is necessary to complete the mission.
2. Tools must appear in execution order.
3. A tool may depend on the result of an earlier tool.
4. To reference the result of a previous tool, use:
   {"$ref": <zero_based_tool_index>}
5. A tool result reference may only refer to an earlier tool.
6. Never invent tool names, parameters, coordinates, or results.
7. Do not execute calculations mentally when 'math_eval' is required.
8. If no tool is required, return:
   {"tools":[]}
9. If the mission cannot be completed with the available tools, return:
   {"tools":[]}
10. Include all tool calls required by the mission, even when they are
independent of one another. Preserve the logical order implied by the mission.

EXAMPLES:
mission: "Calculate 5*5"
output: {
    "tools": [
        { "name": "math_eval", "params": [ "5*5" ] }
    ]
}

mission: "Compute 10-2"
output: {
    "tools": [
        { "name": "math_eval", "params": [ "10-2" ] }
    ]
}

mission: "What is the capital of Italy?"
output: {
    "tools": [
        { "name": "answer_trivia",  "params": [ "What is the capital of Italy?" ] }
    ]
}

mission: "Tell me the name of the owner of Tesla"
output: {
    "tools": [
        { "name": "answer_trivia", params": [ "Who is Tesla's owner?" ] }
    ]
}

mission: "Move to coordinate (4,7) and you get +10pts"
output: {
    "tools": [
        { "name": "move_to", "params": [ 4, 7 ] }
    ]
}

mission: "Calculate 5*5 and then move to (10,20)."
output: {
  "tools": [
    {"name": "math_eval", "params": ["5*5"]},
    {"name": "move_to", "params": [10, 20]}
  ]
}

mission: "Move to x=4*2 y=(1+3)*3 to get +5pts"
output: {
  "tools": [
    { "name": "math_eval", "params": ["4*2"] },
    { "name": "math_eval", "params": ["(1+3)*3"] },
    {
      "name": "move_to",
      "params": [
        {"$ref": 0},
        {"$ref": 1}
      ]
    }
  ]
}
`

export { LEVEL_1_EVALUATION_INSTRUCTIONS, MISSION_CLASSIFICATION_INSTRUCTIONS };

