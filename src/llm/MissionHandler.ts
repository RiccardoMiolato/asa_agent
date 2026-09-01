import { LEVEL_1_EVALUATION_INSTRUCTIONS, MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
import { LLMClient, LLMMessage } from "./LLMClient.js";

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

export class MissionHandler {
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

    async evaluateMission() {
        const missionMsg = this.getPendingMission();

        if(!missionMsg)
            return;

        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Sending mission: ", missionMsg);
        const levelEvaluationRes: string = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);
        const evaluationResult: MsgEvaluationResult = JSON.parse(levelEvaluationRes);

        if(!evaluationResult.worth){
            console.log(`Mission "${missionMsg}" is not worth pursuing`);
            return;
        }

        console.log("First evaluation done", evaluationResult);

        if(evaluationResult.level == 1) {
            await this.handleFirstLevelMissions(missionMsg);
        } else if(evaluationResult.level == 2) {
            this.handleSecondLevelMissions(missionMsg);
        } else if(evaluationResult.level == 3) {
            this.handleThirdLevelMissions(missionMsg);
        }
    }

    private async handleFirstLevelMissions(missionMsg: string) {
        const message: LLMMessage = {
            role: "user",
            content: missionMsg
        };

        console.log("Evaluating level 1 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);
        const actions_chain: MsgEvaluationResult = JSON.parse(evaluationRes);

        console.log(actions_chain);
    }

    private handleSecondLevelMissions(missionMsg: string) {
        console.log("Mission level: 2");
    }

    private handleThirdLevelMissions(missionMsg: string) {
        console.log("Mission level: 3");
    }

    private async sendMessage(messages: LLMMessage[], systemPrompt: string): Promise<string> {
        const response: string = await this.LLMClient.callLLM(messages, systemPrompt);

        return response;
    }
}