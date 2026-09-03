import { PlanningContext } from "../planning.js";
import { CellScoreEffect } from "../utils/_cell-score-effects.js";
import { GameClient } from "../utils/move.js";
import { Position } from "../utils/position.js";
import { MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS } from "./instructions/level_1.js";
import { LEVEL_2_EVALUATION_INSTRUCTION } from "./instructions/level_2.js";
import { LEVEL_3_EVALUATION_INSTRUCTION } from "./instructions/level_3.js";
import { LLMClient, LLMMessage } from "./LLMClient.js";
import { BonusType, Mission, MissionLevel, MissionType } from "./mission.js";
import { answer_trivia, drop_at, get_agent_position, math_eval, move_to, MoveToResponse } from "./tools/tools.js";

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

interface Bonus {
    type: "points" | "multiplier",
    value: number
}

interface ITool {
    name: string,
    params: any[],
    bonus?: Bonus
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

    private activeMissions: Mission[];
    private nextMissionId: number;

    constructor(client: GameClient) {
        const LLM_API_URL = process.env.LITELLM_BASE_URL;
        const LLM_API_KEY = process.env.LITELLM_API_KEY;
        const LLM_MODEL = process.env.LOCAL_MODEL;
        const MAX_TOKENS = Number(process.env.MAX_TOKENS || "0");

        if (!LLM_MODEL || !LLM_API_URL || !LLM_API_KEY)
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
            ["drop_at", drop_at],
            ["get_agent_position", get_agent_position],
            ["answer_trivia", answer_trivia],
        ]);

        this.client = client;
        this.activeMissions = [];
        this.nextMissionId = 1;
    }

    areActiveMissionsPresent(): boolean {
        return this.activeMissions.length > 0;
    }

    getActiveMission(): Mission[] {
        return this.activeMissions;
    }

    /** Exposes fixed move-to rewards and penalties to the route planner. */
    getActiveMoveToEffects(): readonly CellScoreEffect[] {
        return this.activeMissions
            .filter(
                (mission: Mission): boolean =>
                    mission.getType() === "move-to"
                    && mission.getBonusType() !== "multiplier",
            )
            .map(
                (mission: Mission): CellScoreEffect => new CellScoreEffect(
                    mission.getId(),
                    mission.getRelatedCell(),
                    mission.getBonusValue(),
                ),
            );
    }

    /** Completes every one-shot move-to mission triggered at a reached cell. */
    completeMoveToMissionsAt(cell: Position): void {
        this.activeMissions = this.activeMissions.filter(
            (mission: Mission): boolean =>
                mission.getType() !== "move-to"
                || !mission.getRelatedCell().isEqual(cell),
        );
    }

    isMissionWaiting(): boolean {
        return this.pendingChatMessages.length > 0;
    }

    // Waiting list for mission coming from the chat
    addPendingMission(senderId: string, senderName: string, message: string): void {
        this.pendingChatMessages.push({ senderId, senderName, message });
    }

    private getPendingMission(): ChatMessage | undefined {
        return this.pendingChatMessages.shift();
    }

    async evaluateMission(context: PlanningContext): Promise<void> {
        const mission = this.getPendingMission();

        if (!mission)
            return;

        const message: LLMMessage = {
            role: "user",
            content: mission.message
        };

        console.log("Started mission classification...");
        const levelEvaluationRes: string = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);

        if (levelEvaluationRes === "")
            return;

        const evaluationResult = this.parseClassificationJson(levelEvaluationRes);

        if (!evaluationResult)
            return;

        if (evaluationResult.level == 1) {
            await this.handleFirstLevelMissions(context, mission, message, evaluationResult.requires_answer);
        } else if (evaluationResult.level == 2) {
            await this.handleSecondLevelMissions(message);
        } else if (evaluationResult.level == 3) {
            await this.handleThirdLevelMissions(message);
        }
    }

    private async handleFirstLevelMissions(context: PlanningContext, mission: ChatMessage, message: LLMMessage, answer_trivia: boolean): Promise<void> {
        console.log("Evaluating level 1 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);

        console.log(evaluationRes);

        const toolsChain = this.parsePlanningJson(evaluationRes);

        if (!toolsChain || toolsChain.tools.length === 0)
            return;

        const results: any[] = await this.ExecuteTools(
            context,
            1,
            toolsChain,
            mission,
            answer_trivia
        );

        const last_tool: ITool = toolsChain.tools[toolsChain.tools.length - 1];
        if (last_tool.name === "move_to") {
            const lastRes: MoveToResponse = results[results.length - 1] as MoveToResponse;
            console.log(lastRes);
            if (lastRes?.isValid) {
                this.createMoveToMission(lastRes.targetPos, 1, last_tool.bonus);
            }
        } else if (last_tool.name === "drop_at") {
            const lastRes: MoveToResponse = results[results.length - 1] as MoveToResponse;
            if (lastRes?.isValid) {
                this.createDropAtMission(lastRes.targetPos, 1, last_tool.bonus);
            }
        }
    }

    private async handleSecondLevelMissions(message: LLMMessage): Promise<void> {
        console.log("Evaluating level 2 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_2_EVALUATION_INSTRUCTION);

    }

    private async handleThirdLevelMissions(message: LLMMessage): Promise<void> {
        console.log("Evaluating level 3 mission...");
        const evaluationRes: string = await this.sendMessage([message], LEVEL_3_EVALUATION_INSTRUCTION);

    }

    private async ExecuteTools(context: PlanningContext, level: number, toolsChain: ToolPlanningResult, mission: ChatMessage, requires_answer: boolean): Promise<any[]> {
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
                results.push(await this.callTool(context, level, { name: tool.name, params: resolvedParams }));
            } else {
                // No references, execute normally
                console.log(`Executing tool ${tool.name} with params:`, tool.params);
                results.push(await this.callTool(context, level, tool));
            }

            if (requires_answer && results[i] !== undefined && (tool.name === "answer_trivia" || tool.name === "math_eval")) {
                this.client.emitSay(mission.senderId, results[i]);
            }
        }

        return results;
    }

    private parsePlanningJson(jsonString: string): ToolPlanningResult | undefined {
        let toolsChain: ToolPlanningResult;
        try {
            toolsChain = JSON.parse(jsonString);

            return toolsChain;
        } catch (e) {
            console.log("Error parsing tools chain");
            return;
        }
    }


    private parseClassificationJson(jsonString: string): MsgEvaluationResult | undefined {
        let toolsChain: MsgEvaluationResult;
        try {
            toolsChain = JSON.parse(jsonString);

            return toolsChain;
        } catch (e) {
            console.log("Error parsing tools chain");
            return;
        }
    }

    private createMoveToMission(cell: Position, level: MissionLevel, bonus: Bonus | undefined): void {
        if (!bonus)
            return;

        const missionType: MissionType = "move-to";

        let bonusType: BonusType;

        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        } else {
            bonusType = "multiplier";
        }

        const bonusValue = Math.abs(bonus.value);


        const new_mission = new Mission(
            `mission-${this.nextMissionId++}`,
            level,
            missionType,
            bonusType,
            bonusValue,
            cell
        );

        this.activeMissions.push(new_mission);
    }

    private createDropAtMission(cell: Position, level: MissionLevel, bonus: Bonus | undefined): void {
        if (!bonus)
            return;

        const missionType: MissionType = "drop-at";

        let bonusType: BonusType;

        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        } else {
            bonusType = "multiplier";
        }

        const bonusValue = Math.abs(bonus.value);


        const new_mission = new Mission(
            `mission-${this.nextMissionId++}`,
            level,
            missionType,
            bonusType,
            bonusValue,
            cell
        );

        this.activeMissions.push(new_mission);
    }


    private async callTool(context: PlanningContext, level: number, tool: ITool): Promise<any> {
        const toolFunction: Function | undefined = this.toolToFunctionMap.get(tool.name);

        if (!toolFunction) {
            console.log(`Tool ${tool.name} not found`);
            return;
        }

        try {
            let result: any;

            switch (tool.name) {
                case "answer_trivia":
                    result = await toolFunction(this.LLMClient, ...tool.params);
                    break;
                case "math_eval":
                    result = await toolFunction(...tool.params);
                    break;
                default:
                    result = await toolFunction(context, ...tool.params);
                    break;
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
