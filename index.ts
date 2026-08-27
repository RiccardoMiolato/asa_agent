import { DjsConnect, type DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import 'dotenv/config';
import { Agent } from './src/agent.js';
import { AStarPathfinder } from './src/astar.js';
import { Beliefs } from './src/beliefs.js';
import { IntentionGenerator } from './src/desires.js';
import { ActionFactory } from './src/move.js';
import type { IOAgent } from './types/IOAgent.js';
import type { IOConfig } from './types/IOConfig.js';
import type { IOSensing } from './types/IOSensing.js';

// Environment variables and script constants
const host = process.env.HOST || "http://localhost:8080";
const token = process.env.TOKEN || "";
const agent_name = process.env.NAME || "cardo";

console.log("Connecting...");
const socket: DjsClientSocket = DjsConnect(host, token, agent_name);
const beliefs = new Beliefs();
const actionFactory = new ActionFactory(socket, beliefs);
const pathfinder = new AStarPathfinder(actionFactory);
const intentionGenerator = new IntentionGenerator(beliefs);
const agent = new Agent(
    beliefs,
    intentionGenerator,
    pathfinder,
    actionFactory,
);

socket.onConnect((): void => {
    console.log("Connected to the game server!")
});

/**
 * Receive the game configuration so that some belief can be
 * initialized before the agent starts to interact with the
 * environment.
 */
socket.onConfig((config: IOConfig): void => {
    beliefs.configPhase(config);
});

/**
 * Receive the agent information every time something changes
 * in the environment, like the position of the agent itself
 * or other events.
 */
socket.onYou((_agent: IOAgent): void => {
    if (!agent.id)
        agent.id = _agent.id;

    if (_agent.x !== undefined && _agent.y !== undefined) {
        agent.updatePosition(_agent.x, _agent.y);
    }
});

/**
 * Receive the sensing information at each environment step;
 * That include parcels generation, crates position and other
 * players' agent positions.
 */
socket.onSensing((sensing: IOSensing): void => {
    beliefs.senseParcels(sensing.parcels);
    beliefs.senseCrates(sensing.crates);
});

void agent.agent_loop();
