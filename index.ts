import 'dotenv/config';
import { IOParcel } from "./types/IOParcel.js";
import { DjsConnect, DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import { Astar, Position } from "./agent/astar.js";
import agent from './agent/agent.js';
import beliefs from './agent/beliefs.js';

// Environment variables and script constants
const host = process.env.HOST || "http://localhost:8080";
const token = process.env.TOKEN || "";
const agent_name = process.env.NAME || "cardo";

console.log("Connecting...");
const socket: DjsClientSocket = DjsConnect(host, token, agent_name);

socket.onConnect(() => {
    console.log("Connected to the game server!")
});

/**
 * Receive the game configuration so that some belief can be
 * initialized before the agent starts to interact with the
 * environment.
 */
socket.onConfig((config: any) => {
    beliefs.configPhase(config);
});

/**
 * Receive the agent information every time something changes
 * in the environment, like the position of the agent itself
 * or other events.
 */
socket.onYou((_agent: any) => {
    if(!agent.id)
        agent.id = _agent["id"];

    agent.updatePosition(_agent["x"], _agent["y"]);
});

/**
 * Receive the sensing information at each environment step;
 * That include parcels generation, crates position and other
 * players' agent positions.
 */
socket.onSensing((sensing: any) => {
    beliefs.senseParcels(sensing["parcels"]);
    beliefs.senseCrates(sensing["crates"]);
});

agent.agent_loop();
export default socket;