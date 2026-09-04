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

type MapExtreme = "leftmost" | "rightmost" | "downmost" | "topmost";

/** Resolves a relative map extreme to one concrete walkable coordinate. */
function get_extreme_tile(
    context: PlanningContext,
    extreme: MapExtreme,
): Position | undefined {
    const gameMap = context.gameMap;
    let selectedTile: Position | undefined;
    for (let x = 0; x < gameMap.getRows(); x += 1) {
        for (let y = 0; y < gameMap.getCols(); y += 1) {
            const candidate = new Position(x, y);
            if (!gameMap.isValidCell(candidate)) {
                continue;
            }
            if (
                selectedTile === undefined
                || getExtremeCoordinate(candidate, extreme)
                    > getExtremeCoordinate(selectedTile, extreme)
            ) {
                selectedTile = candidate;
            }
        }
    }
    return selectedTile;
}

/** Maps every named extreme onto a consistently maximized coordinate. */
function getExtremeCoordinate(position: Position, extreme: MapExtreme): number {
    switch (extreme) {
        case "leftmost":
            return -position.x;
        case "rightmost":
            return position.x;
        case "downmost":
            return -position.y;
        case "topmost":
            return position.y;
    }
}

interface MoveToResponse {
    isValid: boolean,
    targetPos: Position,
    bonus: number,
}

function drop_at(context: PlanningContext, x: number, y: number, bonus: number): MoveToResponse {
    const gameMap: GameMap = context.gameMap;
    const mapPos = new Position(x, y);

    // Mission parcels may be put down on any walkable tile, including white
    // cells; they are not restricted to the map's regular delivery cells.
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

/** Typed result shared by all persistent level-2 mission tools. */
abstract class BaseLevelTwoConstraint { }

/** Conditional reward rule for deliveries containing exactly one stack size. */
class StackConstraint extends BaseLevelTwoConstraint {
    constructor(
        readonly stackSize: number,
        readonly multiplier: number,
    ) {
        super();
    }
}

export type DeliveryConstraintModifierType = "points" | "multiplier";

/** Persistent reward rule attached to one delivery cell. */
class DeliveryConstraint extends BaseLevelTwoConstraint {
    constructor(
        readonly cell: Position,
        readonly modifierType: DeliveryConstraintModifierType,
        readonly value: number,
    ) {
        super();
    }
}

/** Persistent rule that rewards parcels on one side of a score threshold. */
class ParcelConstraint extends BaseLevelTwoConstraint {
    constructor(
        readonly threshold: number,
        readonly deliverLower: boolean,
    ) {
        super();
    }
}

/** Persistent movement penalty attached to one map cell. */
class AvoidCellConstraint extends BaseLevelTwoConstraint {
    constructor(
        readonly cell: Position,
        readonly penalty: number,
    ) {
        super();
    }
}

function stack_constraint(
    stackSize: number,
    multiplier: number,
): StackConstraint {
    if (!Number.isInteger(stackSize) || stackSize <= 0) {
        throw new RangeError("Stack size must be a positive integer");
    }
    if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new RangeError("Stack multiplier must be a finite non-negative number");
    }
    return new StackConstraint(stackSize, multiplier);
}

function delivery_constraint(
    x: number,
    y: number,
    modifierType: DeliveryConstraintModifierType,
    value: number,
): DeliveryConstraint {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError("Delivery coordinates must be integers");
    }
    if (!Number.isFinite(value)) {
        throw new RangeError("Delivery modifier must be finite");
    }
    if (modifierType === "multiplier" && value < 0) {
        throw new RangeError("Delivery multiplier cannot be negative");
    }
    return new DeliveryConstraint(
        new Position(x, y),
        modifierType,
        value,
    );
}

function parcel_constraint(
    threshold: number,
    deliverLower: boolean,
): ParcelConstraint {
    if (!Number.isFinite(threshold)) {
        throw new RangeError("Parcel score threshold must be finite");
    }
    return new ParcelConstraint(threshold, deliverLower);
}

function avoid_cell(
    x: number,
    y: number,
    penalty: number,
): AvoidCellConstraint {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError("Avoid-cell coordinates must be integers");
    }
    if (!Number.isFinite(penalty) || penalty > 0) {
        throw new RangeError("Avoid-cell penalty must be finite and non-positive");
    }
    return new AvoidCellConstraint(new Position(x, y), penalty);
}

export {
    answer_trivia, AvoidCellConstraint, avoid_cell,
    BaseLevelTwoConstraint, DeliveryConstraint, delivery_constraint, drop_at,
    get_agent_position, get_extreme_tile,
    math_eval, move_to, MoveToResponse, ParcelConstraint, parcel_constraint,
    StackConstraint, stack_constraint, type MapExtreme,
};
