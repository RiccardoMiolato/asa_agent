import { PlanningContext } from "../planning.js";
import {
    type BaseDeliveryScoreEffect,
} from "../_delivery-scoring.js";
import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";
import type { CellScoreEffect } from "../utils/_cell-score-effects.js";
import { GameClient } from "../utils/move.js";
import { Position } from "../utils/position.js";
import { MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS } from "./instructions/level_1.js";
import { LEVEL_2_EVALUATION_INSTRUCTION } from "./instructions/level_2.js";
import { LEVEL_3_EVALUATION_INSTRUCTION } from "./instructions/level_3.js";
import { LLMClient, LLMMessage } from "./LLMClient.js";
import {
    AvoidCellMission,
    BaseCellMission,
    DeliveryCellMission,
    Mission,
    MoveToMission,
    ParcelScoreMission,
    StackSizeMission,
    type BonusType,
    type MissionLevel,
} from "./mission.js";
import {
    answer_trivia,
    AvoidCellConstraint,
    avoid_cell,
    BaseLevelTwoConstraint,
    DeliveryConstraint,
    delivery_constraint,
    drop_at,
    get_agent_position,
    math_eval,
    move_to,
    type MoveToResponse,
    ParcelConstraint,
    parcel_constraint,
    StackConstraint,
    stack_constraint,
    type DeliveryConstraintModifierType,
} from "./tools/tools.js";

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

interface StackConstraintToolCall {
    readonly name: "stack_constraint";
    readonly params: readonly [stackSize: number, multiplier: number];
}

interface DeliveryConstraintToolCall {
    readonly name: "delivery_constraint";
    readonly params: readonly [
        x: number,
        y: number,
        modifierType: DeliveryConstraintModifierType,
        value: number,
    ];
}

interface ParcelConstraintToolCall {
    readonly name: "parcel_constraint";
    readonly params: readonly [threshold: number, deliverLower: boolean];
}

interface AvoidCellToolCall {
    readonly name: "avoid_cell";
    readonly params: readonly [x: number, y: number, penalty: number];
}

type LevelTwoToolCall =
    | StackConstraintToolCall
    | DeliveryConstraintToolCall
    | ParcelConstraintToolCall
    | AvoidCellToolCall;

interface LevelTwoToolPlanningResult {
    readonly tools: readonly LevelTwoToolCall[];
}

interface ChatMessage {
    senderId: string,
    senderName: string,
    message: string
}

export class MissionHandler {
    private readonly toolToFunctionMap: Map<string, Function>;

    private readonly client: GameClient;
    private readonly llmClient: LLMClient;
    private pendingChatMessages: ChatMessage[];

    private activeMissions: Mission[];
    private nextMissionId: number;

    constructor(client: GameClient, llmClient?: LLMClient) {
        const LLM_API_URL = process.env.LITELLM_BASE_URL;
        const LLM_API_KEY = process.env.LITELLM_API_KEY;
        const LLM_MODEL = process.env.LOCAL_MODEL;
        const MAX_TOKENS = Number(process.env.MAX_TOKENS || "0");

        if (llmClient) {
            this.llmClient = llmClient;
        } else {
            if (!LLM_MODEL || !LLM_API_URL || !LLM_API_KEY) {
                throw new Error("Missing ENV parameters for the LLM Agent");
            }
            this.llmClient = new LLMClient(
                LLM_MODEL,
                LLM_API_URL,
                LLM_API_KEY,
                MAX_TOKENS,
            );
        }

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

    getActiveMission(): readonly Mission[] {
        return this.activeMissions;
    }

    /** Exposes one-shot visit effects and persistent avoid-cell penalties. */
    getActiveMoveToEffects(): readonly CellScoreEffect[] {
        return this.activeMissions
            .filter(
                (mission: Mission): mission is MoveToMission | AvoidCellMission =>
                    mission instanceof MoveToMission
                    && mission.getBonusType() !== "multiplier"
                    || mission instanceof AvoidCellMission,
            )
            .map(
                (mission: MoveToMission | AvoidCellMission): CellScoreEffect =>
                    mission.toScoreEffect(),
            );
    }

    /** Completes every one-shot move-to mission triggered at a reached cell. */
    completeMoveToMissionsAt(cell: Position): void {
        this.completeMissionsAt("move-to", cell);
    }

    /** Exposes cell-specific and global delivery policies to the planner. */
    getActiveDeliveryScoreEffects(): readonly BaseDeliveryScoreEffect[] {
        return this.activeMissions
            .filter(
                (
                    mission: Mission,
                ): mission is DeliveryCellMission
                    | StackSizeMission
                    | ParcelScoreMission =>
                    mission instanceof DeliveryCellMission
                    || mission instanceof StackSizeMission
                    || mission instanceof ParcelScoreMission,
            )
            .map(
                (
                    mission: DeliveryCellMission
                        | StackSizeMission
                        | ParcelScoreMission,
                ): BaseDeliveryScoreEffect => mission.toScoreEffect(),
            );
    }

    /** Completes every one-shot drop-at mission fulfilled at a delivery cell. */
    completeDropAtMissionsAt(cell: Position): void {
        this.completeMissionsAt("drop-at", cell);
    }

    private completeMissionsAt(
        missionType: "move-to" | "drop-at",
        cell: Position,
    ): void {
        this.activeMissions = this.activeMissions.filter(
            (mission: Mission): boolean =>
                !(mission instanceof BaseCellMission)
                || !mission.isConsumable()
                || mission.getType() !== missionType
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

    async evaluateMission(context: PlanningContext): Promise<readonly Mission[]> {
        const mission = this.getPendingMission();

        if (!mission)
            return [];

        const message: LLMMessage = {
            role: "user",
            content: mission.message
        };

        const levelEvaluationRes: string = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);

        if (levelEvaluationRes === "")
            return [];

        const evaluationResult = this.parseClassificationJson(levelEvaluationRes);

        if (!evaluationResult)
            return [];

        if (evaluationResult.level == 1) {
            const activatedMission = await this.handleFirstLevelMissions(
                context,
                mission,
                message,
                evaluationResult.requires_answer,
            );
            return activatedMission ? [activatedMission] : [];
        } else if (evaluationResult.level == 2) {
            return this.handleSecondLevelMissions(context, message);
        } else if (evaluationResult.level == 3) {
            await this.handleThirdLevelMissions(message);
        }
        return [];
    }

    private async handleFirstLevelMissions(context: PlanningContext, mission: ChatMessage, message: LLMMessage, answer_trivia: boolean): Promise<Mission | undefined> {
        const evaluationRes: string = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);

        const toolsChain = this.parsePlanningJson(evaluationRes);

        if (!toolsChain || toolsChain.tools.length === 0)
            return undefined;

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
            if (lastRes?.isValid) {
                return this.createMoveToMission(
                    lastRes.targetPos,
                    1,
                    last_tool.bonus,
                );
            }
        } else if (last_tool.name === "drop_at") {
            const lastRes: MoveToResponse = results[results.length - 1] as MoveToResponse;
            if (lastRes?.isValid) {
                return this.createDropAtMission(
                    lastRes.targetPos,
                    1,
                    last_tool.bonus,
                );
            }
        }
        return undefined;
    }

    private async handleSecondLevelMissions(
        context: PlanningContext,
        message: LLMMessage,
    ): Promise<readonly Mission[]> {
        console.log("Evaluating level 2 mission...");
        const evaluationRes = await this.sendMessage(
            [message],
            LEVEL_2_EVALUATION_INSTRUCTION,
        );
        const plan = this.parseLevelTwoPlanningJson(evaluationRes);
        if (!plan) {
            return [];
        }

        const constraints: BaseLevelTwoConstraint[] = [];
        try {
            for (const tool of plan.tools) {
                constraints.push(this.executeLevelTwoTool(tool));
            }
        } catch (error: unknown) {
            console.error("Invalid level-2 mission constraint", error);
            return [];
        }
        return this.activateLevelTwoConstraints(context, constraints);
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
                const resolvedParams = tool.params.map((param: any) => {
                    if (param && param.$ref !== undefined) {
                        return results[param.$ref];
                    }
                    return param;
                });
                results.push(await this.callTool(context, level, { name: tool.name, params: resolvedParams }));
            } else {
                // No references, execute normally
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

    private parseLevelTwoPlanningJson(
        jsonString: string,
    ): LevelTwoToolPlanningResult | undefined {
        try {
            const parsed: unknown = JSON.parse(jsonString);
            if (!MissionHandler.isRecord(parsed)) {
                return undefined;
            }
            const tools = parsed["tools"];
            if (!Array.isArray(tools)) {
                return undefined;
            }

            const parsedTools: LevelTwoToolCall[] = [];
            for (const tool of tools) {
                const parsedTool = this.parseLevelTwoToolCall(tool);
                if (!parsedTool) {
                    return undefined;
                }
                parsedTools.push(parsedTool);
            }
            return { tools: parsedTools };
        } catch (error: unknown) {
            console.error("Error parsing level-2 tools chain", error);
            return undefined;
        }
    }

    private parseLevelTwoToolCall(value: unknown): LevelTwoToolCall | undefined {
        if (!MissionHandler.isRecord(value)) {
            return undefined;
        }
        const name = value["name"];
        const params = value["params"];
        if (typeof name !== "string" || !Array.isArray(params)) {
            return undefined;
        }

        switch (name) {
            case "stack_constraint":
                return params.length === 2
                    && MissionHandler.isNumber(params[0])
                    && MissionHandler.isNumber(params[1])
                    ? { name, params: [params[0], params[1]] }
                    : undefined;
            case "delivery_constraint": {
                const modifierType = params[2];
                return params.length === 4
                    && MissionHandler.isNumber(params[0])
                    && MissionHandler.isNumber(params[1])
                    && (
                        modifierType === "points"
                        || modifierType === "multiplier"
                    )
                    && MissionHandler.isNumber(params[3])
                    ? {
                        name,
                        params: [
                            params[0],
                            params[1],
                            modifierType,
                            params[3],
                        ],
                    }
                    : undefined;
            }
            case "parcel_constraint":
                return params.length === 2
                    && MissionHandler.isNumber(params[0])
                    && typeof params[1] === "boolean"
                    ? { name, params: [params[0], params[1]] }
                    : undefined;
            case "avoid_cell":
                return params.length === 3
                    && MissionHandler.isNumber(params[0])
                    && MissionHandler.isNumber(params[1])
                    && MissionHandler.isNumber(params[2])
                    ? { name, params: [params[0], params[1], params[2]] }
                    : undefined;
            default:
                return undefined;
        }
    }

    private executeLevelTwoTool(
        tool: LevelTwoToolCall,
    ): BaseLevelTwoConstraint {
        switch (tool.name) {
            case "stack_constraint":
                return stack_constraint(...tool.params);
            case "delivery_constraint":
                return delivery_constraint(...tool.params);
            case "parcel_constraint":
                return parcel_constraint(...tool.params);
            case "avoid_cell":
                return avoid_cell(...tool.params);
        }
    }

    /** Activates validated persistent constraints from any mission source. */
    activateLevelTwoConstraints(
        context: PlanningContext,
        constraints: readonly BaseLevelTwoConstraint[],
    ): readonly Mission[] {
        const activatedMissions: Mission[] = [];
        for (const constraint of constraints) {
            const mission = this.createLevelTwoMission(context, constraint);
            if (mission) {
                this.activeMissions.push(mission);
                activatedMissions.push(mission);
            }
        }
        return activatedMissions;
    }

    private createLevelTwoMission(
        context: PlanningContext,
        constraint: BaseLevelTwoConstraint,
    ): Mission | undefined {
        const missionId = `mission-${this.nextMissionId}`;
        let mission: Mission | undefined;

        if (constraint instanceof StackConstraint) {
            mission = new StackSizeMission(
                missionId,
                constraint.stackSize,
                constraint.multiplier,
            );
        } else if (constraint instanceof DeliveryConstraint) {
            const isDeliveryCell = context.deliveringCells.some(
                (cell: Position): boolean => cell.isEqual(constraint.cell),
            );
            if (!isDeliveryCell) {
                return undefined;
            }
            const bonusType: BonusType = constraint.modifierType === "multiplier"
                ? "multiplier"
                : constraint.value < 0
                    ? "penalty"
                    : "reward";
            mission = new DeliveryCellMission(
                missionId,
                2,
                bonusType,
                Math.abs(constraint.value),
                constraint.cell,
                SCORE_EFFECT_LIFETIME.PERSISTENT,
            );
        } else if (constraint instanceof ParcelConstraint) {
            mission = new ParcelScoreMission(
                missionId,
                constraint.threshold,
                constraint.deliverLower,
            );
        } else if (constraint instanceof AvoidCellConstraint) {
            if (!context.gameMap.isValidCell(constraint.cell)) {
                return undefined;
            }
            mission = new AvoidCellMission(
                missionId,
                constraint.penalty,
                constraint.cell,
            );
        }

        if (mission) {
            this.nextMissionId += 1;
        }
        return mission;
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }

    private static isNumber(value: unknown): value is number {
        return typeof value === "number" && Number.isFinite(value);
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

    private createMoveToMission(cell: Position, level: MissionLevel, bonus: Bonus | undefined): Mission | undefined {
        if (!bonus)
            return undefined;

        let bonusType: BonusType;

        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        } else {
            bonusType = "multiplier";
        }

        const bonusValue = Math.abs(bonus.value);


        const new_mission = new MoveToMission(
            `mission-${this.nextMissionId++}`,
            level,
            bonusType,
            bonusValue,
            cell
        );

        this.activeMissions.push(new_mission);
        return new_mission;
    }

    private createDropAtMission(cell: Position, level: MissionLevel, bonus: Bonus | undefined): Mission | undefined {
        if (!bonus)
            return undefined;

        let bonusType: BonusType;

        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        } else {
            bonusType = "multiplier";
        }

        const bonusValue = Math.abs(bonus.value);


        const new_mission = new DeliveryCellMission(
            `mission-${this.nextMissionId++}`,
            level,
            bonusType,
            bonusValue,
            cell
        );

        this.activeMissions.push(new_mission);
        return new_mission;
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
                    result = await toolFunction(this.llmClient, ...tool.params);
                    break;
                case "math_eval":
                    result = await toolFunction(...tool.params);
                    break;
                default:
                    result = await toolFunction(context, ...tool.params);
                    break;
            }

            return result;
        } catch (error) {
            console.log(`Error executing tool ${tool.name}: `, error);
        }
    }

    private async sendMessage(messages: LLMMessage[], systemPrompt: string): Promise<string> {
        try {
            const response: string = await this.llmClient.callLLM(
                messages,
                systemPrompt,
            );

            return response;
        } catch (error) {
            console.log("LLM call failed: ", error);
            return "";
        }
    }
}
