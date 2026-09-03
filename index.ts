import { DjsConnect, type DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import { GhostMapServer } from './src/_ghost-map-server.js';
import { AgentGhostMapSnapshotProvider } from './src/_ghost-map-snapshot.js';
import { Agent, AGENT_EXIT_REASON } from './src/agent.js';
import { Beliefs } from './src/bdi/beliefs.js';
import { DesireGenerator } from './src/bdi/desires.js';
import { MissionHandler } from "./src/llm/MissionHandler.js";
import { ConsoleAgentLogger } from './src/utils/_logging.js';
import { AStarPathfinder } from "./src/utils/astar.js";
import { ActionFactory } from "./src/utils/move.js";
import type { IOAgent } from './types/IOAgent.js';
import { IOConfig } from "./types/IOConfig.js";
import type { IOSensing } from './types/IOSensing.js';
// Environment variables and script constants
const host = process.env.HOST || "http://localhost:8080";
const token = process.env.TOKEN || "";
const agent_name = process.env.NAME || "cardo";

const llmHost = process.env.LLM_HOST || "http://localhost:8080";
const llmToken = process.env.LLM_TOKEN || "";
const llmAgentName = process.env.LLM_NAME || "cardo";

const ghostMapPort = Number(process.env.GHOST_MAP_PORT ?? "8081");
const branchAndBoundSvgEnabled =
    process.env.BRANCH_AND_BOUND_SVG_ENABLED === "true";

console.log("Connecting...");
const socket: DjsClientSocket = DjsConnect(host, token, agent_name);
const beliefs = new Beliefs();
const actionFactory = new ActionFactory(socket, beliefs);
const pathfinder = new AStarPathfinder(actionFactory);
const agent = new Agent(
    beliefs,
    new DesireGenerator(),
    pathfinder,
    actionFactory,
    new ConsoleAgentLogger({ branchAndBoundSvgEnabled }),
    true,
    new MissionHandler(socket),
);
const ghostMapServer = new GhostMapServer(
    new AgentGhostMapSnapshotProvider(agent, beliefs, agent_name),
    ghostMapPort,
);

void ghostMapServer.start()
    .then((): void => {
        console.log(`Ghost map available at http://localhost:${ghostMapPort}`);
    })
    .catch((error: unknown): void => {
        console.error(
            `Could not start ghost map on port ${ghostMapPort}:`,
            error,
        );
    });

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

    agent.updateScore(_agent.score);

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
    const revision = beliefs.reviseWithChanges(
        sensing.parcels,
        sensing.crates,
        sensing.positions,
        sensing.agents,
    );

    agent.signalBeliefRevision(revision);
});

socket.onMsg((senderId: string, senderName: string, message: any) => {
    if(agent.usesLLM())
        agent.handleMsgFromChat(senderId, senderName, message);
});

void agent.agent_loop()
    .then(async (exitReason: AGENT_EXIT_REASON): Promise<void> => {
        switch (exitReason) {
            case AGENT_EXIT_REASON.NO_FEASIBLE_PLAN:
                console.error("No feasible plan exists for any intention. Quitting the game.");
                socket.disconnect();
                await ghostMapServer.stop();
                return;
        }
    })
    .catch(async (error: unknown): Promise<void> => {
        console.error("Agent loop crashed:", error);
        socket.disconnect();
        try {
            await ghostMapServer.stop();
        } finally {
            process.exitCode = 1;
        }
    });
