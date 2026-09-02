import { IntentionContext } from "../../bdi/intentions.js";
import { GameMap } from "../../utils/map.js";
import { Position } from "../../utils/position.js";
import { TRIVIA_ANSWERING_RULES } from "../instructions/instruction.js";
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

function get_agent_position(context: IntentionContext): Position {
    return context.agentPosition;
}

function drop_parcels(): string {
    return "Dropping parcels"
}


interface MoveToResponse {
    isValid: boolean,
    targetPos: Position,
    bonus: number,
}

function move_to(context: IntentionContext, x: number, y: number, bonus: number): MoveToResponse {
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

function add_constraints(
    x: number,
    y: number,
    constraint_type: string,
    multiplier: number | undefined,
    reward: number
): string {
    return `Blocking tile at coordinates (x=${x}, y=${y})`;
}

export { answer_trivia, get_agent_position, math_eval, move_to };

