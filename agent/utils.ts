import type { Position } from "./position.js";

/**
 * Returns the string of the direction the agent is moving to,
 * given the previous position and the actual one, it is possible to
 * understand in which axis and direction the agent is moving
 */
export function getDirection(actual_pos: Position, next_pos: Position): string {
    if (actual_pos.x < next_pos.x) {
        return 'right';
    } else if (actual_pos.x > next_pos.x) {
        return 'left';
    } else if (actual_pos.y < next_pos.y) {
        return 'up';
    } else if (actual_pos.y > next_pos.y) {
        return 'down';
    }

    return '';
}
