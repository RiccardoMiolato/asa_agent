import { IntentionContext } from "../bdi/intentions.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS, MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
import { LLMClient, LLMMessage } from "./LLMClient.js";
import { answer_trivia, get_agent_position, math_eval, move_to } from "./tools/tools.js";

/**
 * This is the main agent, responsible for keeping track
 * of word changes and act accordingly.
 *
 * However, it delegates decision making to the LLMClient
 */
interface MsgEvaluationResult {
    level: number,
    worth: boolean,
    motivation: string
}

interface ITool{
    name: string,
    params: any[]
}

interface ToolPlanningResult {
    tools: ITool[]
}

export class MissionHandler {
    private readonly toolToFunctionMap: Map<string, Function>;

    private LLMClient: LLMClient;
    private pendingChatMessages: string[];

    constructor() {
        const LLM_API_URL = process.env.LITELLM_BASE_URL;
        const LLM_API_KEY = process.env.LITELLM_API_KEY;
        const LLM_MODEL = process.env.LOCAL_MODEL;
        const MAX_TOKENS = Number(process.env.MAX_TOKENS || "0");

        if(!LLM_MODEL || !LLM_API_URL || !LLM_API_KEY)
            throw new Error("Missing ENV parameters for the LLM Agent");

        this.LLMClient = new LLMClient(
            LLM_MODEL,
            LLM_API_URL,
            LLM_API_KEY,
            MAX_TOKENS
        );

        this.pendingChatMessages = [];
        this.toolToFunctionMap = new Map<string, Function>([
            ["math_eval", math_eval],
            ["move_to", move_to],
            ["get_agent_position", get_agent_position],
            ["answer_trivia", answer_trivia],
        ]);
    }

    isMissionWaiting(): boolean {
        return this.pendingChatMessages.length > 0;
    }

    // Waiting list for mission coming from the chat
    addPendingMission(message: string): void {
        this.pendingChatMessages.push(message);
    }

    private getPendingMission(): string | undefined{
        return this.pendingChatMessages.shift();
    }

    async evaluateMission(context: IntentionContext): Promise<void> {
        const missionMsg = this.getPendingMission();

        if(!missionMsg)
            return;

        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Started mission classification...");
        const levelEvaluationRes: string = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);

        if(levelEvaluationRes === "")
            return;

        const evaluationResult: MsgEvaluationResult = JSON.parse(levelEvaluationRes);

        if(evaluationResult.level == 1) {
            await this.handleFirstLevelMissions(context, missionMsg);
        } else if(evaluationResult.level == 2) {
            await this.handleSecondLevelMissions(context, missionMsg);
        } else if(evaluationResult.level == 3) {
            await this.handleThirdLevelMissions(context, missionMsg);
        }
    }

    private async handleFirstLevelMissions(context: IntentionContext, missionMsg: string) {
        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Evaluating level 1 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);

        if(evaluationRes === "")
            return;

        const actions_chain: ToolPlanningResult = JSON.parse(evaluationRes);

        await this.ExecuteTools(actions_chain, context);
    }

    private async handleSecondLevelMissions(context: IntentionContext, missionMsg: string) {
        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Evaluating level 2 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);
        const actions_chain: MsgEvaluationResult = JSON.parse(evaluationRes);

        console.log(actions_chain);
    }

    private async handleThirdLevelMissions(context: IntentionContext, missionMsg: string) {
        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Evaluating level 3 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);
        const actions_chain: MsgEvaluationResult = JSON.parse(evaluationRes);

        console.log(actions_chain);
    }

    private async ExecuteTools(toolsChain: ToolPlanningResult, context: IntentionContext): Promise<any[]> {
        const results: any[] = [];

        for (let i = 0; i < (toolsChain.tools ?? []).length; i++) {
            const tool = toolsChain.tools[i];

            // Check if THIS tool has $ref params
            if (tool.params?.some((param: any) => param?.$ref !== undefined)) {
                // Resolve $ref to previous results
                console.log(tool.params);
                const resolvedParams = tool.params.map((param: any) => {
                    console.log(results, param, param.$ref, param['$ref']);
                    if (param && param.$ref !== undefined) {
                        return results[param.$ref];
                    }
                    return param;
                });
                console.log(`Executing tool ${tool.name} with resolved params:`, resolvedParams);
                results.push(await this.callTool(context, { name: tool.name, params: resolvedParams }));
            } else {
                // No references, execute normally
                console.log(`Executing tool ${tool.name} with params:`, tool.params);
                results.push(await this.callTool(context, tool));
            }
        }

        return results;
    }

    private async callTool(context: IntentionContext, tool: ITool): Promise<any> {
        const toolFunction = this.toolToFunctionMap.get(tool.name);

        if(!toolFunction) {
            console.log(`Tool ${tool.name} not found`);
            return;
        }

        try {
            let result: any;

            if(tool.name === "answer_trivia" || tool.name === "math_eval")
                result = toolFunction(...tool.params);
            else
                result = toolFunction(context, ...tool.params);

            console.log(`Tool ${tool.name} executed with result: `, result);

            return result;
        } catch (error) {
            console.log(`Error executing tool ${tool.name}: `, error);
        }
    }

    private async sendMessage(messages: LLMMessage[], systemPrompt: string): Promise<string> {
        try {
            const response: string = await this.LLMClient.callLLM(messages, systemPrompt);

            return response;
        } catch (error) {
            console.log("LLM call failed: ", error);
            return "";
        }
    }
}