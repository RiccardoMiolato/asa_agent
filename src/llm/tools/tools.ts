import { IntentionContext } from "../../bdi/intentions.js";
import { GameMap } from "../../utils/map.js";
import { Position } from "../../utils/position.js";

function answer_trivia(question: string): string {
    return "Answer is ...";
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
    const gameMap: GameMap = new GameMap(context.gameMap);
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

