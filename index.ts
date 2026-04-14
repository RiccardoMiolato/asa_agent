import 'dotenv/config';
import { IOParcel } from "./types/IOParcel.js";
import { DjsConnect, DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import { Astar, Position } from "./astar.js";

// Environment variables and script constants
const host = process.env.HOST || "http://localhost:8080";
const token = process.env.TOKEN || "";
const agent_name = process.env.NAME || "cardo";

// My agent variables
let myPosition = { x: 0, y: 0};

const beliefs = {
    crates: new Map<String, Position>(),
    delivering_cells: [] as Position[],
    state: 0 as number, // 0: looking for a parcel, 1: delivering a parcel
};

// List of sensed parcels
const parcelMap = new Map<String, IOParcel>();

let map: String[][];

// Path finding for reaching the next free parcel
let next_parcel: Position | undefined = undefined;
let path_to_next: Position[] | null = null;


console.log("Connecting...");
const socket: DjsClientSocket = DjsConnect(host, token, agent_name);

socket.onConnect(() => {
    console.log("Connected to the game server!")
});

/*
* Receive the game configuration so that some belief can be
* initialized before the agent starts to interact with the
* environment.
*/
socket.onConfig((config: any) => {
    map = config["GAME"]["map"]["tiles"];

    console.log(map);

    map.forEach((row: String[]) => {
        row.forEach((cell: String) => {
            if (cell == "2") {
                beliefs.delivering_cells.push(new Position(map.indexOf(row), row.indexOf(cell)));
            }
        });
    });
});

socket.onYou(async (agent: any) => {
    // console.log(agent);
    myPosition = {
        x: agent["x"],
        y: agent["y"]
    };
});

/**
 * Receive the sensing information at each environment step;
 * That include parcels generation, crates position and other
 * players' agent positions.
 */
socket.onSensing((sensing: any) => {
    // console.log(sensing);

    sensing["parcels"].forEach((parcel: IOParcel) => {
        parcelMap.set(parcel["id"], parcel);

        if (next_parcel == undefined && parcel["carriedBy"] == null) {
            next_parcel = new Position(parcel["x"], parcel["y"]);
            path_to_next = Astar(map, new Position(myPosition["x"], myPosition["y"]), next_parcel, beliefs.crates);
        }

        parcelMap.forEach((parcel, key) => {
            if (parcel["reward"] == 1) {
                parcelMap.delete(key);
            }
        });
    });

    sensing["crates"].forEach((crate: any) => {
        if(!beliefs.crates.has(crate["id"])){
            beliefs.crates.set(crate["id"], new Position(crate["x"], crate["y"]));
        } else {
            const crate_obj = beliefs.crates.get(crate["id"]);

            if (crate_obj) {
                if (crate_obj.x != crate["x"] || crate_obj.y != crate["y"]) {
                    beliefs.crates.set(crate["id"], new Position(crate["x"], crate["y"]));
                }
            }
        }
    });

    // console.log(parcelMap);
});

// socket.onMap((width, height, tiles) => {
    // console.log("'map' -- event received");
    // console.log(`Map dimensions: ${width} x ${height}`);
    // console.log("Tiles:");
    // console.log(tiles);
// });

function getDirection(actual_pos: Position, next_pos: Position): String {
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

function getNextParcel(): Position | undefined {
    if (parcelMap.size == 0) {
        return undefined;
    } else if (!next_parcel) {
        for (const parcel of parcelMap.values()) {
            if(parcel["carriedBy"] == null) {
                return new Position(parcel["x"], parcel["y"]);
            }
        }
    }

    return undefined;
}

async function makeMove() {
    if(myPosition.x % 1 === 0 && myPosition.y % 1 === 0 && next_parcel != undefined && path_to_next != null) {
        if (path_to_next.length > 0) {
            const next_position = path_to_next.shift();

            if (next_position != undefined) {
                const direction = getDirection(myPosition, next_position);

                if (direction != ''){
                    const result = await socket.emitMove(direction);

                    // In case of little inconveniences, like another agent blocking the path, the easiest solution is to retry a few times
                    // TODO: If the path is obstructed by a moved crate, it may be better to recalculate the path
                    if(!result) {
                        for (let i = 0; i < 3; i++) {
                            const retry_res = await socket.emitMove(direction);

                            if(retry_res) break;
                        }
                    }
                }
            }
        } else if (beliefs.state == 0){
            await socket.emitPickup();

            beliefs.state = 1;
            path_to_next = Astar(map, new Position(myPosition["x"], myPosition["y"]), beliefs.delivering_cells[0], beliefs.crates);
        } else if (beliefs.state == 1){
            await socket.emitPutdown();

            beliefs.state = 0;
            next_parcel = getNextParcel();

            if (next_parcel != undefined) {
                path_to_next = Astar(map, new Position(myPosition["x"], myPosition["y"]), next_parcel, beliefs.crates);
            }
        }
    } else {
        next_parcel = getNextParcel();
        if (next_parcel) {
            path_to_next = Astar(map, new Position(myPosition["x"], myPosition["y"]), next_parcel, beliefs.crates);
        }
    }
}

// Agent loop
while(true) {
    await new Promise(r => setTimeout(r, 100));

    await makeMove();
}