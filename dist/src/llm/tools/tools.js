import { Position } from "../../utils/position.js";
import { TRIVIA_ANSWERING_RULES } from "../instructions/level_1.js";
async function answer_trivia(llmClient, question) {
    const message = {
        role: "user",
        content: question
    };
    console.log(`\tAnswering to \"${question}\"`);
    const answer = await llmClient.callLLM([message], TRIVIA_ANSWERING_RULES);
    if (answer === "")
        return "Unable to provide an answer to the queston";
    try {
        const answerObj = JSON.parse(answer);
        return answerObj.answer;
    }
    catch (e) {
        return "Unable to parse LLM answer";
    }
}
function math_eval(expression) {
    console.log(expression);
    try {
        const result = Function(`"use strict"; return (${expression})`)();
        if (typeof result !== 'number' || isNaN(result)) {
            throw new Error('Invalid expression');
        }
        return result;
    }
    catch (error) {
        throw new Error('Error evaluating expression');
    }
}
function get_agent_position(context) {
    return context.agentPosition;
}
/** Resolves a relative map extreme to one concrete walkable coordinate. */
function get_extreme_tile(context, extreme) {
    const gameMap = context.gameMap;
    let selectedTile;
    for (let x = 0; x < gameMap.getRows(); x += 1) {
        for (let y = 0; y < gameMap.getCols(); y += 1) {
            const candidate = new Position(x, y);
            if (!gameMap.isValidCell(candidate)) {
                continue;
            }
            if (selectedTile === undefined
                || getExtremeCoordinate(candidate, extreme)
                    > getExtremeCoordinate(selectedTile, extreme)) {
                selectedTile = candidate;
            }
        }
    }
    return selectedTile;
}
/** Maps every named extreme onto a consistently maximized coordinate. */
function getExtremeCoordinate(position, extreme) {
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
function drop_at(context, x, y, bonus) {
    const gameMap = context.gameMap;
    const mapPos = new Position(x, y);
    // Mission parcels may be put down on any walkable tile, including white
    // cells; they are not restricted to the map's regular delivery cells.
    if (!gameMap.isValidCell(mapPos)) {
        return {
            isValid: false,
            targetPos: mapPos,
            bonus: 0
        };
    }
    return {
        isValid: true,
        targetPos: mapPos,
        bonus: bonus
    };
}
function move_to(context, x, y, bonus) {
    const gameMap = context.gameMap;
    const mapPos = new Position(x, y);
    if (!gameMap.isValidCell(mapPos)) {
        return {
            isValid: false,
            targetPos: mapPos,
            bonus: 0
        };
    }
    return {
        isValid: true,
        targetPos: mapPos,
        bonus: bonus
    };
}
/** Typed result shared by all persistent level-2 mission tools. */
class BaseLevelTwoConstraint {
}
/** Conditional reward rule for deliveries containing exactly one stack size. */
class StackConstraint extends BaseLevelTwoConstraint {
    constructor(stackSize, multiplier) {
        super();
        this.stackSize = stackSize;
        this.multiplier = multiplier;
    }
}
/** Persistent reward rule attached to one delivery cell. */
class DeliveryConstraint extends BaseLevelTwoConstraint {
    constructor(cell, modifierType, value) {
        super();
        this.cell = cell;
        this.modifierType = modifierType;
        this.value = value;
    }
}
/** Persistent rule that rewards parcels on one side of a score threshold. */
class ParcelConstraint extends BaseLevelTwoConstraint {
    constructor(threshold, deliverLower) {
        super();
        this.threshold = threshold;
        this.deliverLower = deliverLower;
    }
}
/** Persistent movement penalty attached to one map cell. */
class AvoidCellConstraint extends BaseLevelTwoConstraint {
    constructor(cell, penalty) {
        super();
        this.cell = cell;
        this.penalty = penalty;
    }
}
function stack_constraint(stackSize, multiplier) {
    if (!Number.isInteger(stackSize) || stackSize <= 0) {
        throw new RangeError("Stack size must be a positive integer");
    }
    if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new RangeError("Stack multiplier must be a finite non-negative number");
    }
    return new StackConstraint(stackSize, multiplier);
}
function delivery_constraint(x, y, modifierType, value) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError("Delivery coordinates must be integers");
    }
    if (!Number.isFinite(value)) {
        throw new RangeError("Delivery modifier must be finite");
    }
    if (modifierType === "multiplier" && value < 0) {
        throw new RangeError("Delivery multiplier cannot be negative");
    }
    return new DeliveryConstraint(new Position(x, y), modifierType, value);
}
function parcel_constraint(threshold, deliverLower) {
    if (!Number.isFinite(threshold)) {
        throw new RangeError("Parcel score threshold must be finite");
    }
    return new ParcelConstraint(threshold, deliverLower);
}
function avoid_cell(x, y, penalty) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RangeError("Avoid-cell coordinates must be integers");
    }
    if (!Number.isFinite(penalty) || penalty > 0) {
        throw new RangeError("Avoid-cell penalty must be finite and non-positive");
    }
    return new AvoidCellConstraint(new Position(x, y), penalty);
}
export { answer_trivia, AvoidCellConstraint, avoid_cell, BaseLevelTwoConstraint, DeliveryConstraint, delivery_constraint, drop_at, get_agent_position, get_extreme_tile, math_eval, move_to, ParcelConstraint, parcel_constraint, StackConstraint, stack_constraint, };
//# sourceMappingURL=tools.js.map