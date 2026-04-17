import { Position } from "./astar.js";
import beliefs from "./beliefs.js";

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
 * Decides which is the best parcel to pick next
 * If i don't know valid parcel positions around the map, I will move
 * to a random parcel spawn point, hoping to find a parcel
 */
export function getNextParcel(): Position | undefined {
    if (beliefs.parcels.size == 0) {
        beliefs.target_parcel = undefined;

        if (beliefs.pickup_cells.length > 0) {
            const index = Math.floor(Math.random() * beliefs.pickup_cells.length);
            return beliefs.pickup_cells[index];
        }

        return undefined;
    } else if (beliefs.target_pos == undefined && beliefs.state == 0) {
        for (const parcel of beliefs.parcels.values()) {
            if(parcel.carriedBy == null) {
                beliefs.target_parcel = parcel.id;
                return new Position(parcel.x, parcel.y);
            }
        }

        if (beliefs.pickup_cells.length > 0) {
            const index = Math.floor(Math.random() * beliefs.pickup_cells.length);
            return beliefs.pickup_cells[index];
        }
    }

    return undefined;
}
