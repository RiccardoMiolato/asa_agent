import { Heap } from 'heap-js'

export class Position {
    public x: number
    public y: number

    public constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

// Starting_pos and target_pos are both tuple of type
/**
 * {x: number, y: number}
 */
export function Astar(game_map: String[][], starting_pos: Position, target_pos: Position, crates: Map<String, Position>): Position[] | null {
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

        if (current && current.x === target_pos.x && current.y === target_pos.y) {
            return reconstruct_path(cameFrom, current);
        }

        if(current){
            const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            const directions = ['up', 'down', 'right', 'left'];

            neighbors.forEach(coord => {
                let neighbor = new Position(current.x + coord[0], current.y + coord[1]);

                if(!valid_cell(neighbor, game_map, directions[neighbors.indexOf(coord)], crates)) {
                    return;
                }

                if(neighbor) {
                    const tentative_gScore = gScore.get(`${current.x}${current.y}`)! + 1;
                    if (tentative_gScore < gScore.get(`${neighbor.x}${neighbor.y}`)!) {
                        cameFrom.set(`${neighbor.x}${neighbor.y}`, current);
                        gScore.set(`${neighbor.x}${neighbor.y}`, tentative_gScore);
                        fScore.set(`${neighbor.x}${neighbor.y}`, tentative_gScore + heuristic(neighbor, target_pos));

                        if (!openSet.toArray().some(pos => pos.x === neighbor.x && pos.y === neighbor.y))
                            openSet.add(neighbor);
                    }
                }
            });
        }
    }

    return null; // No path found
}

function valid_cell(neighbor: Position, game_map: String[][], direction: String, crates: Map<String, Position>): boolean {
    // Out of bound indexes
    if (neighbor.x < 0 || neighbor.x >= game_map.length || neighbor.y < 0 || neighbor.y >= game_map[0].length) {
        return false;
    }

    // Not walkable block
    if (game_map[neighbor.x][neighbor.y] === '0') {
        return false;
    } else if (game_map[neighbor.x][neighbor.y] === '↑' && direction === 'down' ||
                game_map[neighbor.x][neighbor.y] === '→' && direction === 'left' ||
                game_map[neighbor.x][neighbor.y] === '↓' && direction === 'up' ||
                game_map[neighbor.x][neighbor.y] === '←' && direction === 'right'
    ) {
        return false;
    } else if (game_map[neighbor.x][neighbor.y].includes("5")) {
        let path_obstructed = false;

        crates.forEach((cratePos, _) => {
            if (cratePos.x === neighbor.x && cratePos.y === neighbor.y) {
                path_obstructed = true;
            }
        });

        if (path_obstructed) {
            return false;
        }
    }

    return true;
}

function reconstruct_path(cameFrom: Map<String, Position>, current: Position): Position[]{
    const total_path = [current];
    while (cameFrom.has(`${current.x}${current.y}`)) {
        current = cameFrom.get(`${current.x}${current.y}`)!;
        total_path.unshift(current);
    }

    total_path.shift(); // Remove the starting position, corresponds to the agent position in the map
    return total_path;
}

// Auxiliary function to calculate the heuristic distance betweeen
// two nodes in the map for A* algorithm
function heuristic(pos1: Position, pos2: Position) {
    return Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y);
}