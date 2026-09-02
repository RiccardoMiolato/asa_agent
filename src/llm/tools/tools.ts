import { PlanningContext } from "../../planning.js";
import { GameMap } from "../../utils/map.js";
import { Position } from "../../utils/position.js";
import { TRIVIA_ANSWERING_RULES } from "../instructions/level_1.js";
import { LLMClient, LLMMessage } from "../LLMClient.js";

async function answer_trivia(llmClient: LLMClient, question: string): Promise<string> {
    const message: LLMMessage = {
        role: "user",
        content: question
    };

    console.log(`\tAnswering to \"${question}\"`)
    const answer = await llmClient.callLLM([message], TRIVIA_ANSWERING_RULES);

    if(answer === "")
        return "Unable to provide an answer to the queston";

    try {
        const answerObj = JSON.parse(answer);
        return answerObj.answer;
    } catch (e) {
        return "Unable to parse LLM answer";
    }
}

function math_eval(expression: string): number {
    console.log(expression);
    try {
        const result = Function(`"use strict"; return (${expression})`)();
        if (typeof result !== 'number' || isNaN(result)) {
            throw new Error('Invalid expression');
        }
        return result;
    } catch (error) {
        throw new Error('Error evaluating expression');
    }
}

function get_agent_position(context: PlanningContext): Position {
    return context.agentPosition;
}

interface MoveToResponse {
    isValid: boolean,
    targetPos: Position,
    bonus: number,
}

function drop_at(context: PlanningContext, x: number, y: number, bonus: number): MoveToResponse {
    const gameMap: GameMap = context.gameMap;
    const mapPos = new Position(x, y);

    if (!gameMap.isValidCell(mapPos)){
        return {
            isValid: false,
            targetPos: mapPos,
            bonus: 0
        }
    }

    return {
        isValid: true,
        targetPos: mapPos,
        bonus: bonus
    }
}

function move_to(context: PlanningContext, x: number, y: number, bonus: number): MoveToResponse {
    const gameMap: GameMap = context.gameMap;
    const mapPos = new Position(x, y);

    if (!gameMap.isValidCell(mapPos)){
        return {
            isValid: false,
            targetPos: mapPos,
            bonus: 0
        }
    }

    return {
        isValid: true,
        targetPos: mapPos,
        bonus: bonus
    }
}

interface Constraint {

}

function stack_constraint(stack_size: number) {
    throw new Error("Not implemented yet");
}

function delivery_constraint(x: number, y: number, type: string, bonus: number) {
    throw new Error("Not implemented yet");
}

function parcel_constraint(score: number, deliverLower: boolean) {
    throw new Error("Not implemented yet");
}

function avoid_cell(x: number, y: number, penalty: number) {
    throw new Error("Not implemented yet");
}

export {
    answer_trivia, avoid_cell, delivery_constraint, drop_at,
    get_agent_position,
    math_eval,
    move_to, MoveToResponse, parcel_constraint, stack_constraint
};

