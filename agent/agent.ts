import { Astar, Position } from "./astar.js";
import beliefs from "./beliefs.js";
import { getDirection, getNextParcel } from "./utils.js";
import socket from "../index.js";

class Agent {
    id: string;
    position: Position;

    constructor() {
        this.id = "";
        this.position = new Position(0,0); // Initialize beliefs with default values
    }

    updatePosition(x: number, y: number): void{
        this.position.x = x;
        this.position.y = y;
    }

    async makeMove() {
        for (const parcel of beliefs.parcels.values()) {
            const parcel_pos = new Position(parcel.x, parcel.y);
            if(this.position.isEqual(parcel_pos)) {
                await socket.emitPickup();
            }
        }

        if(this.position.x % 1 === 0 && this.position.y % 1 === 0 && beliefs.target_pos != undefined && beliefs.followed_path != null) {
            if (beliefs.followed_path.length > 0) {
                const next_position = beliefs.followed_path.shift();

                if (next_position != undefined) {
                    const direction = getDirection(this.position, next_position);

                    if (direction != ''){
                        let result = await socket.emitMove(direction);

                        if(!result) {
                            for (let i = 0; i < 3; i++) {
                                const retry_res = await socket.emitMove(direction);

                                if(retry_res) {
                                    result = true;
                                    break;
                                }
                            }

                            // If after few tries I can't reach my goal, I have to recalculate the
                            // path considering the position blocked by an agent or whatever
                            if(!result) {
                                beliefs.followed_path = Astar(beliefs.map, new Position(this.position.x, this.position.y), beliefs.target_pos, beliefs.crates);
                            }
                        }
                    }
                }
            } else if (beliefs.state == 0){
                await socket.emitPickup();

                beliefs.target_parcel = undefined;
                beliefs.state = 1;
                beliefs.followed_path = Astar(beliefs.map, new Position(this.position.x, this.position.y), beliefs.delivering_cells[0], beliefs.crates);
            } else if (beliefs.state == 1){
                await socket.emitPutdown();
                beliefs.clearDeliveredParcels();

                beliefs.state = 0;
                beliefs.target_pos = getNextParcel();

                if (beliefs.target_pos != undefined) {
                    beliefs.followed_path = Astar(beliefs.map, new Position(this.position.x, this.position.y), beliefs.target_pos, beliefs.crates);
                }
            }
        } else {
            beliefs.target_pos = getNextParcel();
            if (beliefs.target_pos) {
                beliefs.followed_path = Astar(beliefs.map, new Position(this.position.x, this.position.y), beliefs.target_pos, beliefs.crates);
            }
        }
    }


    async agent_loop() {
        while(true) {
            await new Promise(r => setTimeout(r, beliefs.movement_duration));

            await this.makeMove();
        }
    }
}

export default new Agent();