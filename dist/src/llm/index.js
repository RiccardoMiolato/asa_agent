import "dotenv/config";
import { LLMClient } from "./LLMClient.js";
import { MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
const test_msgs = [
    {
        level: 1,
        description: "Pick up an order from Restaurant A. (+10 points)",
    },
    {
        level: 1,
        description: "Deliver an order to Customer B. (+15 points)",
    },
    {
        level: 1,
        description: "Pick up the wrong order. (-5 points)",
    },
    {
        level: 2,
        description: "Pick up parcels from Restaurant C to earn double points.",
    },
    {
        level: 2,
        description: "Deliver to Customer D to earn half points.",
    },
    {
        level: 2,
        description: "Pick up from Restaurant E and deliver to Customer F for double points.",
    },
    {
        level: 3,
        description: "Coordinate with Agent X to deliver two orders simultaneously. (+20 points)",
    },
    {
        level: 3,
        description: "Assist Agent Y in picking up a large order. (+15 points)",
    },
    {
        level: 3,
        description: "Avoid overlapping routes with Agent Z to optimize delivery time. (-10 points)",
    },
    {
        level: 3,
        description: "Work with Agent W to handle a high-priority order. (+25 points)",
    }
];
const llmClient = new LLMClient(process.env.LOCAL_MODEL || "", process.env.LITELLM_BASE_URL || "", process.env.LITELLM_API_KEY || "", Number(process.env.MAX_TOKENS) || 1000);
test_msgs.forEach(async (msg) => {
    const llmMsg = [{
            role: "user",
            content: msg.description
        }];
    const res = await llmClient.callLLM(llmMsg, MISSION_CLASSIFICATION_INSTRUCTIONS);
    console.log(`From: ${msg.description}\nTo: ${res}`);
});
//# sourceMappingURL=index.js.map