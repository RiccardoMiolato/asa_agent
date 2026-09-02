import { IntentionContext } from "../bdi/intentions.js";
import { GameClient } from "../utils/move.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS, LEVEL_2_EVALUATION_INSTRUCTION, LEVEL_3_EVALUATION_INSTRUCTION, MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
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
    motivation: string,
    requires_answer: boolean
}

interface ITool{
    name: string,
    params: any[]
}

interface ToolPlanningResult {
    tools: ITool[]
}

interface ChatMessage {
    senderId: string,
    senderName: string,
    message: string
}

export class MissionHandler {
    private readonly toolToFunctionMap: Map<string, Function>;

    private readonly client: GameClient;
    private LLMClient: LLMClient;
    private pendingChatMessages: ChatMessage[];

    constructor(client: GameClient) {
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

        this.client = client;
    }

    isMissionWaiting(): boolean {
        return this.pendingChatMessages.length > 0;
    }

    // Waiting list for mission coming from the chat
    addPendingMission(senderId: string, senderName: string, message: string): void {
        this.pendingChatMessages.push({senderId, senderName, message});
    }

    private getPendingMission(): ChatMessage | undefined{
        return this.pendingChatMessages.shift();
    }

    async evaluateMission(context: IntentionContext): Promise<void> {
        const mission = this.getPendingMission();

        if(!mission)
            return;

        const message: LLMMessage = {
            role: "user",
            content: mission.message
        };

        console.log("Started mission classification...");
        const levelEvaluationRes: string = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);

        if(levelEvaluationRes === "")
            return;

        const evaluationResult: MsgEvaluationResult = JSON.parse(levelEvaluationRes);

        let handleRes: string = "";
        if(evaluationResult.level == 1) {
            handleRes = await this.handleFirstLevelMissions(message);
        } else if(evaluationResult.level == 2) {
            handleRes = await this.handleSecondLevelMissions(message);
        } else if(evaluationResult.level == 3) {
            handleRes = await this.handleThirdLevelMissions(message);
        }

        if(handleRes === "")
            return;

        let toolsChain: ToolPlanningResult;
        try{
            toolsChain = JSON.parse(handleRes)
        } catch(e) {
            console.log("Error parsing tools chain");
            return;
        }

        await this.ExecuteTools(context, toolsChain, mission, evaluationResult.requires_answer);
    }

    private async handleFirstLevelMissions(message: LLMMessage): Promise<string> {
        console.log("Evaluating level 1 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);

        return evaluationRes;
    }

    private async handleSecondLevelMissions(message: LLMMessage): Promise<string> {
        console.log("Evaluating level 2 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_2_EVALUATION_INSTRUCTION);

        return evaluationRes;
    }

    private async handleThirdLevelMissions(message: LLMMessage): Promise<string> {
        console.log("Evaluating level 3 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_3_EVALUATION_INSTRUCTION);

        return evaluationRes;
    }

    private async ExecuteTools(context: IntentionContext, toolsChain: ToolPlanningResult, mission: ChatMessage, requires_answer: boolean): Promise<any[]> {
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

            if (requires_answer && results[i] !== undefined && (tool.name === "answer_trivia" || tool.name === "math_eval")) {
                this.client.emitSay(mission.senderId, results[i]);
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

            if(tool.name === "answer_trivia"){
                result = await toolFunction(this.LLMClient, ...tool.params);
            } else if(tool.name === "math_eval"){
                result = toolFunction(...tool.params);
            } else{
                result = toolFunction(context, ...tool.params);
            }

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