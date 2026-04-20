import { Heap } from 'heap-js'

/**
 * Class position. Helper used in the project for not dealing anywhere with
 * a couple of coordinates {x, y}
 */
export class Position {
    public x: number
    public y: number

    public constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    // Shortcut to compare two classes
    isEqual(other: Position): boolean {
        return this.x === other.x && this.y === other.y;
    }

    // Return the distance between two cells in the map
    distanceTo(other: Position): number {
        return Math.abs(this.x - other.x) + Math.abs(this.y - other.y);
    }
}

/**
 * This is the pathfinding algorithm chosen to be implemented. Since the map is a grid, and usually it's not very big,
 * A* seems the best choice because the heuristic approach should generally decrease the number of nodes explored.
 * Being the agent a real time agent, it is important to be fast during the decision making approach
 */
export function Astar(game_map: String[][], starting_pos: Position, target_pos: Position, crates: Map<String, Position>, temporary_locked: Position | undefined = undefined): Position[] {
    if(starting_pos.x % 1 !== 0 || starting_pos.y % 1 !== 0) {
        return [];
    }

    const openSet = new Heap<Position>((a: Position, b: Position) => fScore.get(`${a.x}${a.y}`)! - fScore.get(`${b.x}${b.y}`)!);
    const cameFrom = new Map<String, Position>();

    openSet.add(starting_pos);

    // Initialize gscore
    const gScore = new Map<String, number>();
    for (let i = 0; i < game_map.length; i++) {
        for (let j = 0; j < game_map[0].length; j++) {
            gScore.set(`${i}${j}`, Infinity);
        }
    }
    gScore.set(`${starting_pos.x}${starting_pos.y}`, 0);

    // Initialize fscore
    const fScore = new Map<String, number>();
    for (let i = 0; i < game_map.length; i++) {
        for (let j = 0; j < game_map[0].length; j++) {
            fScore.set(`${i}${j}`, Infinity);
        }
    }
    fScore.set(`${starting_pos.x}${starting_pos.y}`, heuristic(starting_pos, target_pos));

    while (openSet.size() > 0) {
        let current = openSet.pop();

        if (current && current.isEqual(target_pos)) {
            return reconstruct_path(cameFrom, current);
        }

        if(current){
            const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            const directions = ['up', 'down', 'right', 'left'];

            neighbors.forEach(coord => {
                let neighbor = new Position(current.x + coord[0], current.y + coord[1]);

                if(!valid_cell(neighbor, game_map, directions[neighbors.indexOf(coord)], crates, temporary_locked)) {
                    return;
                }

                if(neighbor) {
                    const tentative_gScore = gScore.get(`${current.x}${current.y}`)! + 1;
                    if (tentative_gScore < gScore.get(`${neighbor.x}${neighbor.y}`)!) {
                        cameFrom.set(`${neighbor.x}${neighbor.y}`, current);
                        gScore.set(`${neighbor.x}${neighbor.y}`, tentative_gScore);
                        fScore.set(`${neighbor.x}${neighbor.y}`, tentative_gScore + heuristic(neighbor, target_pos));

                        if (!openSet.toArray().some(pos => pos.isEqual(neighbor)))
                            openSet.add(neighbor);
                    }
                }
            });
        }
    }

    return []; // No path found
}

/**
 * Utils function for A* algorithm. Validates if the agent can go to the next cell or not,
 * both because it is not part of the map, or because it is obstructed by something, such as a wall or
 * another agent.
 */
function valid_cell(neighbor: Position, game_map: String[][], direction: String, crates: Map<String, Position>, temporary_locked: Position | undefined): boolean {
    // Out of bound indexes
    if (neighbor.x < 0 || neighbor.x >= game_map.length ||
        neighbor.y < 0 || neighbor.y >= game_map[0].length) {
        return false;
    }

    // Not walkable block
    if (game_map[neighbor.x][neighbor.y] === '0') {
        return false;
    } else if (game_map[neighbor.x][neighbor.y] === '↑' && direction === 'down' ||
                game_map[neighbor.x][neighbor.y] === '→' && direction === 'left' ||
                game_map[neighbor.x][neighbor.y] === '↓' && direction === 'up' ||
                game_map[neighbor.x][neighbor.y] === '←' && direction === 'right') {
        return false;
    } else if (game_map[neighbor.x][neighbor.y].includes("5")) {
        // If the cell may contain a crate, I check for obstructions
        let path_obstructed = false;

        crates.forEach((cratePos, _) => {
            if (cratePos.isEqual(neighbor)) {
                path_obstructed = true;
            }
        });

        if (path_obstructed) {
            return false;
        }
    } else if (temporary_locked != undefined && neighbor.isEqual(temporary_locked)) {
        return false;
    }

    return true;
}

/**
 * A* path reconstruction algorithm. Once the pathfinding is finished, the complete path
 * is built following a backtracking approach, starting from the end to the start
 */
function reconstruct_path(cameFrom: Map<String, Position>, current: Position): Position[]{
    const total_path = [current];
    while (cameFrom.has(`${current.x}${current.y}`)) {
        current = cameFrom.get(`${current.x}${current.y}`)!;
        total_path.unshift(current);
    }

    total_path.shift(); // Remove the starting position, corresponds to the agent position in the map
    return total_path;
}

/**
 * Auxiliary function to calculate the heuristic distance betweeen
 * two nodes in the map for A* algorithm
 */
function heuristic(pos1: Position, pos2: Position) {
    return pos1.distanceTo(pos2);
}