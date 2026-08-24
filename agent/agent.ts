import { Position } from "./astar.js";
import beliefs from "./beliefs.js";
import { Intention } from "./intentions.js";

/**
 * Class that manages the main agent logic
 * Keeps track of the agent statistics and continues to
 * check the environment to decide the best move available
 */
class Agent {
    id: string;
    position: Position;

    intentions: Intention[];

    constructor() {
        this.id = "";
        this.position = new Position(0,0); // Initialize beliefs with default values

        this.intentions = [];
    }

    updatePosition(x: number, y: number): void{
        this.position.x = x;
        this.position.y = y;
    }

    /**
     * Main agent's logic loop
     */
    async agent_loop() {
        while(true) {
            await new Promise(r => setTimeout(r, beliefs.movement_duration));
        }
    }
}

export default new Agent();