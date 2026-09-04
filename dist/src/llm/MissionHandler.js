import { SCORE_EFFECT_LIFETIME } from "../_score-effect-lifetime.js";
import { MISSION_CLASSIFICATION_INSTRUCTIONS } from "./instructions/instruction.js";
import { LEVEL_1_EVALUATION_INSTRUCTIONS } from "./instructions/level_1.js";
import { LEVEL_2_EVALUATION_INSTRUCTION } from "./instructions/level_2.js";
import { LEVEL_3_EVALUATION_INSTRUCTION } from "./instructions/level_3.js";
import { LLMClient } from "./LLMClient.js";
import { AvoidCellMission, BaseCellMission, DeliveryCellMission, GridFormationMission, MoveToMission, ParcelScoreMission, ParcelHandoffMission, RendezvousMission, StackSizeMission, } from "./mission.js";
import { GridPositionObjective, ReachableRendezvousPositionSelector, RendezvousObjective, } from "./tools/rendezvous/index.js";
import { answer_trivia, AvoidCellConstraint, avoid_cell, DeliveryConstraint, delivery_constraint, drop_at, get_agent_position, get_extreme_tile, math_eval, move_to, ParcelConstraint, parcel_constraint, StackConstraint, stack_constraint, } from "./tools/tools.js";
export class MissionHandler {
    constructor(client, llmClient, rendezvousPositionSelector = new ReachableRendezvousPositionSelector()) {
        this.rendezvousPositionSelector = rendezvousPositionSelector;
        const LLM_API_URL = process.env.LITELLM_BASE_URL;
        const LLM_API_KEY = process.env.LITELLM_API_KEY;
        const LLM_MODEL = process.env.LOCAL_MODEL;
        const MAX_TOKENS = Number(process.env.MAX_TOKENS || "0");
        if (llmClient) {
            this.llmClient = llmClient;
        }
        else {
            if (!LLM_MODEL || !LLM_API_URL || !LLM_API_KEY) {
                throw new Error("Missing ENV parameters for the LLM Agent");
            }
            this.llmClient = new LLMClient(LLM_MODEL, LLM_API_URL, LLM_API_KEY, MAX_TOKENS);
        }
        this.pendingChatMessages = [];
        this.toolToFunctionMap = new Map([
            ["math_eval", math_eval],
            ["move_to", move_to],
            ["drop_at", drop_at],
            ["get_agent_position", get_agent_position],
            ["get_extreme_tile", get_extreme_tile],
            ["answer_trivia", answer_trivia],
        ]);
        this.client = client;
        this.activeMissions = [];
        this.nextMissionId = 1;
    }
    areActiveMissionsPresent() {
        return this.activeMissions.length > 0;
    }
    getActiveMission() {
        return this.activeMissions;
    }
    /** Removes a mission completed by an external coordination service. */
    completeMission(missionId) {
        this.activeMissions = this.activeMissions.filter((mission) => mission.getId() !== missionId);
    }
    /** Exposes one-shot visit effects and persistent avoid-cell penalties. */
    getActiveMoveToEffects() {
        return this.activeMissions
            .filter((mission) => mission instanceof MoveToMission
            && mission.getBonusType() !== "multiplier"
            || mission instanceof AvoidCellMission)
            .map((mission) => mission.toScoreEffect());
    }
    /** Completes every one-shot move-to mission triggered at a reached cell. */
    completeMoveToMissionsAt(cell) {
        this.completeMissionsAt("move-to", cell);
    }
    /** Exposes cell-specific and global delivery policies to the planner. */
    getActiveDeliveryScoreEffects() {
        return this.activeMissions
            .filter((mission) => mission instanceof DeliveryCellMission
            || mission instanceof StackSizeMission
            || mission instanceof ParcelScoreMission)
            .map((mission) => mission.toScoreEffect());
    }
    /** Completes every one-shot drop-at mission fulfilled at a delivery cell. */
    completeDropAtMissionsAt(cell) {
        this.completeMissionsAt("drop-at", cell);
    }
    completeMissionsAt(missionType, cell) {
        this.activeMissions = this.activeMissions.filter((mission) => !(mission instanceof BaseCellMission)
            || !mission.isConsumable()
            || mission.getType() !== missionType
            || !mission.getRelatedCell().isEqual(cell));
    }
    isMissionWaiting() {
        return this.pendingChatMessages.length > 0;
    }
    // Waiting list for mission coming from the chat
    addPendingMission(senderId, senderName, message) {
        this.pendingChatMessages.push({ senderId, senderName, message });
    }
    getPendingMission() {
        return this.pendingChatMessages.shift();
    }
    async evaluateMission(context) {
        const mission = this.getPendingMission();
        if (!mission)
            return [];
        const message = {
            role: "user",
            content: mission.message
        };
        const levelEvaluationRes = await this.sendMessage([message], MISSION_CLASSIFICATION_INSTRUCTIONS);
        if (levelEvaluationRes === "")
            return [];
        const evaluationResult = this.parseClassificationJson(levelEvaluationRes);
        if (!evaluationResult)
            return [];
        if (evaluationResult.level == 1) {
            const activatedMission = await this.handleFirstLevelMissions(context, mission, message, evaluationResult.requires_answer);
            return activatedMission ? [activatedMission] : [];
        }
        else if (evaluationResult.level == 2) {
            return this.handleSecondLevelMissions(context, message);
        }
        else if (evaluationResult.level == 3) {
            return this.handleThirdLevelMissions(context, message);
        }
        return [];
    }
    async handleFirstLevelMissions(context, mission, message, answer_trivia) {
        const evaluationRes = await this.sendMessage([message], LEVEL_1_EVALUATION_INSTRUCTIONS);
        const toolsChain = this.parsePlanningJson(evaluationRes);
        if (!toolsChain || toolsChain.tools.length === 0)
            return undefined;
        const results = await this.ExecuteTools(context, 1, toolsChain, mission, answer_trivia);
        const last_tool = toolsChain.tools[toolsChain.tools.length - 1];
        if (last_tool.name === "move_to") {
            const lastRes = results[results.length - 1];
            if (lastRes?.isValid) {
                return this.createMoveToMission(lastRes.targetPos, 1, last_tool.bonus);
            }
        }
        else if (last_tool.name === "drop_at") {
            const lastRes = results[results.length - 1];
            if (lastRes?.isValid) {
                return this.createDropAtMission(lastRes.targetPos, 1, last_tool.bonus);
            }
        }
        return undefined;
    }
    async handleSecondLevelMissions(context, message) {
        console.log("Evaluating level 2 mission...");
        const evaluationRes = await this.sendMessage([message], LEVEL_2_EVALUATION_INSTRUCTION);
        const plan = this.parseLevelTwoPlanningJson(evaluationRes);
        if (!plan) {
            return [];
        }
        const constraints = [];
        try {
            for (const tool of plan.tools) {
                constraints.push(this.executeLevelTwoTool(tool));
            }
        }
        catch (error) {
            console.error("Invalid level-2 mission constraint", error);
            return [];
        }
        return this.activateLevelTwoConstraints(context, constraints);
    }
    async handleThirdLevelMissions(context, message) {
        console.log("Evaluating level 3 mission...");
        const evaluationRes = await this.sendMessage([message], LEVEL_3_EVALUATION_INSTRUCTION);
        const plan = this.parseLevelThreePlanningJson(evaluationRes);
        if (!plan || plan.tools.length !== 1) {
            return [];
        }
        const tool = plan.tools[0];
        if (!tool) {
            return [];
        }
        const mission = tool.name === "plan_rendezvous"
            ? this.planRendezvous(context, tool)
            : tool.name === "plan_grid_formation"
                ? this.planGridFormation(tool)
                : this.planParcelHandoff(tool);
        if (!mission) {
            return [];
        }
        this.activeMissions.push(mission);
        return [mission];
    }
    async ExecuteTools(context, level, toolsChain, mission, requires_answer) {
        const results = [];
        for (let i = 0; i < (toolsChain.tools ?? []).length; i++) {
            const tool = toolsChain.tools[i];
            // Check if THIS tool has $ref params
            if (tool.params?.some((param) => param?.$ref !== undefined)) {
                // Resolve $ref to previous results
                const resolvedParams = tool.params.map((param) => {
                    if (param && param.$ref !== undefined) {
                        const referencedResult = results[param.$ref];
                        if (param.property === undefined) {
                            return referencedResult;
                        }
                        if (typeof param.property === "string"
                            && MissionHandler.isRecord(referencedResult)) {
                            return referencedResult[param.property];
                        }
                        return undefined;
                    }
                    return param;
                });
                results.push(await this.callTool(context, level, { name: tool.name, params: resolvedParams }));
            }
            else {
                // No references, execute normally
                results.push(await this.callTool(context, level, tool));
            }
            if (requires_answer && results[i] !== undefined && (tool.name === "answer_trivia" || tool.name === "math_eval")) {
                this.client.emitSay(mission.senderId, results[i]);
            }
        }
        return results;
    }
    parsePlanningJson(jsonString) {
        let toolsChain;
        try {
            toolsChain = MissionHandler.parseLlmJson(jsonString);
            return toolsChain;
        }
        catch (e) {
            console.log("Error parsing tools chain");
            return;
        }
    }
    parseLevelTwoPlanningJson(jsonString) {
        try {
            const parsed = MissionHandler.parseLlmJson(jsonString);
            if (!MissionHandler.isRecord(parsed)) {
                return undefined;
            }
            const tools = parsed["tools"];
            if (!Array.isArray(tools)) {
                return undefined;
            }
            const parsedTools = [];
            for (const tool of tools) {
                const parsedTool = this.parseLevelTwoToolCall(tool);
                if (!parsedTool) {
                    return undefined;
                }
                parsedTools.push(parsedTool);
            }
            return { tools: parsedTools };
        }
        catch (error) {
            console.error("Error parsing level-2 tools chain", error);
            return undefined;
        }
    }
    parseLevelTwoToolCall(value) {
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
                    && (modifierType === "points"
                        || modifierType === "multiplier")
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
    parseLevelThreePlanningJson(jsonString) {
        try {
            const parsed = MissionHandler.parseLlmJson(jsonString);
            if (!MissionHandler.isRecord(parsed)) {
                return undefined;
            }
            const tools = parsed["tools"];
            if (!Array.isArray(tools)) {
                return undefined;
            }
            const parsedTools = [];
            for (const tool of tools) {
                const parsedTool = this.parseLevelThreeToolCall(tool);
                if (!parsedTool) {
                    return undefined;
                }
                parsedTools.push(parsedTool);
            }
            return { tools: parsedTools };
        }
        catch (error) {
            console.error("Error parsing level-3 tools chain", error);
            return undefined;
        }
    }
    parseLevelThreeToolCall(value) {
        if (!MissionHandler.isRecord(value)) {
            return undefined;
        }
        const name = value["name"];
        const params = value["params"];
        if (!Array.isArray(params)) {
            return undefined;
        }
        if (name === "plan_rendezvous") {
            return params.length === 4
                && params.every(MissionHandler.isNumber)
                ? {
                    name,
                    params: [params[0], params[1], params[2], params[3]],
                }
                : undefined;
        }
        if (name === "plan_parcel_handoff") {
            return params.length === 1
                && MissionHandler.isNumber(params[0])
                ? { name, params: [params[0]] }
                : undefined;
        }
        if (name !== "plan_grid_formation" || params.length !== 3) {
            return undefined;
        }
        const llmAgentObjective = GridPositionObjective.parse(params[0]);
        const bdiAgentObjective = GridPositionObjective.parse(params[1]);
        return llmAgentObjective
            && bdiAgentObjective
            && MissionHandler.isNumber(params[2])
            ? {
                name,
                params: [llmAgentObjective, bdiAgentObjective, params[2]],
            }
            : undefined;
    }
    executeLevelTwoTool(tool) {
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
    activateLevelTwoConstraints(context, constraints) {
        const activatedMissions = [];
        for (const constraint of constraints) {
            const mission = this.createLevelTwoMission(context, constraint);
            if (mission) {
                this.activeMissions.push(mission);
                activatedMissions.push(mission);
            }
        }
        return activatedMissions;
    }
    createLevelTwoMission(context, constraint) {
        const missionId = `mission-${this.nextMissionId}`;
        let mission;
        if (constraint instanceof StackConstraint) {
            mission = new StackSizeMission(missionId, constraint.stackSize, constraint.multiplier);
        }
        else if (constraint instanceof DeliveryConstraint) {
            const isDeliveryCell = context.deliveringCells.some((cell) => cell.isEqual(constraint.cell));
            if (!isDeliveryCell) {
                return undefined;
            }
            const bonusType = constraint.modifierType === "multiplier"
                ? "multiplier"
                : constraint.value < 0
                    ? "penalty"
                    : "reward";
            mission = new DeliveryCellMission(missionId, 2, bonusType, Math.abs(constraint.value), constraint.cell, SCORE_EFFECT_LIFETIME.PERSISTENT);
        }
        else if (constraint instanceof ParcelConstraint) {
            mission = new ParcelScoreMission(missionId, constraint.threshold, constraint.deliverLower);
        }
        else if (constraint instanceof AvoidCellConstraint) {
            if (!context.gameMap.isValidCell(constraint.cell)) {
                return undefined;
            }
            mission = new AvoidCellMission(missionId, constraint.penalty, constraint.cell);
        }
        if (mission) {
            this.nextMissionId += 1;
        }
        return mission;
    }
    createRendezvousMission(objective, selection) {
        const mission = new RendezvousMission(`mission-${this.nextMissionId}`, objective.center, objective.maximumDistance, objective.reward, selection.llmAgentTarget, selection.bdiAgentTarget);
        this.nextMissionId += 1;
        return mission;
    }
    planRendezvous(context, tool) {
        let objective;
        try {
            objective = new RendezvousObjective(...tool.params);
        }
        catch (error) {
            console.error("Invalid level-3 rendezvous objective", error);
            return undefined;
        }
        const selection = this.rendezvousPositionSelector.select(context, objective);
        return selection
            ? this.createRendezvousMission(objective, selection)
            : undefined;
    }
    planGridFormation(tool) {
        const [llmAgentObjective, bdiAgentObjective, reward] = tool.params;
        if (!Number.isFinite(reward) || reward <= 0) {
            return undefined;
        }
        const mission = new GridFormationMission(`mission-${this.nextMissionId}`, reward, llmAgentObjective, bdiAgentObjective);
        this.nextMissionId += 1;
        return mission;
    }
    planParcelHandoff(tool) {
        const [reward] = tool.params;
        if (reward <= 0) {
            return undefined;
        }
        const mission = new ParcelHandoffMission(`mission-${this.nextMissionId}`, reward);
        this.nextMissionId += 1;
        return mission;
    }
    static isRecord(value) {
        return typeof value === "object" && value !== null;
    }
    static isNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }
    /**
     * Parses a bare JSON response or one JSON object wrapped in a code fence.
     * Additional prose remains invalid so malformed plans cannot be executed.
     */
    static parseLlmJson(jsonString) {
        const response = jsonString.trim();
        const fencedResponse = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(response);
        return JSON.parse(fencedResponse?.[1] ?? response);
    }
    parseClassificationJson(jsonString) {
        let toolsChain;
        try {
            toolsChain = MissionHandler.parseLlmJson(jsonString);
            return toolsChain;
        }
        catch (e) {
            console.log("Error parsing tools chain");
            return;
        }
    }
    createMoveToMission(cell, level, bonus) {
        if (!bonus)
            return undefined;
        let bonusType;
        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        }
        else {
            bonusType = "multiplier";
        }
        const bonusValue = Math.abs(bonus.value);
        const new_mission = new MoveToMission(`mission-${this.nextMissionId++}`, level, bonusType, bonusValue, cell);
        this.activeMissions.push(new_mission);
        return new_mission;
    }
    createDropAtMission(cell, level, bonus) {
        if (!bonus)
            return undefined;
        let bonusType;
        if (bonus.type === "points") {
            bonusType = bonus.value < 0 ? "penalty" : "reward";
        }
        else {
            bonusType = "multiplier";
        }
        const bonusValue = Math.abs(bonus.value);
        const new_mission = new DeliveryCellMission(`mission-${this.nextMissionId++}`, level, bonusType, bonusValue, cell);
        this.activeMissions.push(new_mission);
        return new_mission;
    }
    async callTool(context, level, tool) {
        const toolFunction = this.toolToFunctionMap.get(tool.name);
        if (!toolFunction) {
            console.log(`Tool ${tool.name} not found`);
            return;
        }
        try {
            let result;
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
        }
        catch (error) {
            console.log(`Error executing tool ${tool.name}: `, error);
        }
    }
    async sendMessage(messages, systemPrompt) {
        try {
            const response = await this.llmClient.callLLM(messages, systemPrompt);
            return response;
        }
        catch (error) {
            console.log("LLM call failed: ", error);
            return "";
        }
    }
}
//# sourceMappingURL=MissionHandler.js.map