import { Position } from "./astar.js";

/**
 * Returns the string of the direction the agent is moving to,
 * given the previous position and the actual one, it is possible to
 * understand in which axis and direction the agent is moving
 */
export function getDirection(actual_pos: Position, next_pos: Position): String {
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


/**
 * Given a position (the agent), and a list of positions (delivering cells)
 * Returns the closest delivering cell to the agent, so it can deliver
 * without loosing too much time
 */
export function getClosestDeliveringCell(agent_pos: Position, delivering_cells: Position[], unreachable_cell: Position | undefined = undefined): Position | undefined {
    let closest_cell: Position | undefined = undefined;
    let min_distance = Number.MAX_VALUE;

    for (const cell of delivering_cells) {
        if(unreachable_cell) {
            if(cell.isEqual(unreachable_cell))
                continue;
        }

        const distance = agent_pos.distanceTo(cell);

        if (distance < min_distance) {
            min_distance = distance;
            closest_cell = cell;
        }
    }

    return closest_cell;
}