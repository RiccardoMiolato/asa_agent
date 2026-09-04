import { DjsConnect, type DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import { Agent } from "../agent.js";
import { AgentGhostMapSnapshotProvider } from "../_ghost-map-snapshot.js";
import { GhostMapServer } from "../_ghost-map-server.js";
import { Beliefs } from "../bdi/beliefs.js";
import { DesireGenerator } from "../bdi/desires.js";
import {
    AGENT_ROLE,
    ConsoleAgentCommunicationLogger,
    DeliverooAgentCommunicationChannel,
    PeerHandshakeService,
} from "../communication/index.js";
import { MissionHandler } from "../llm/MissionHandler.js";
import {
    PeerRendezvousCoordinator,
    ReachableGridPositionSelector,
} from "../llm/tools/rendezvous/index.js";
import { PeerParcelHandoffCoordinator } from "../llm/tools/handoff/index.js";
import { ConsoleAgentLogger } from "../utils/_logging.js";
import { AStarPathfinder } from "../utils/astar.js";
import { ActionFactory } from "../utils/move.js";
import type { AgentRuntimeConfig } from "./_config.js";
import { ConsoleAgentRuntimeLogger } from "./_logging.js";
import { AgentRuntime } from "./_runtime.js";

/** Creates a fully wired runtime while keeping construction out of the entrypoint. */
export class AgentRuntimeFactory {
    /** Creates one isolated agent, transport, handshake, and observer runtime. */
    static make(config: AgentRuntimeConfig): AgentRuntime {
        const socket: DjsClientSocket = DjsConnect(
            config.host,
            config.token,
            config.token.length > 0 ? undefined : config.name,
            false,
        );
        const beliefs = new Beliefs();
        const actionFactory = new ActionFactory(socket, beliefs);
        const pathfinder = new AStarPathfinder(actionFactory);
        const usesLLM = config.role === AGENT_ROLE.LLM;
        const communicationLogger = new ConsoleAgentCommunicationLogger();
        const communicationChannel =
            new DeliverooAgentCommunicationChannel(
                socket,
                config.peerName,
                communicationLogger,
            );
        const gridPositionSelector = new ReachableGridPositionSelector();
        const rendezvousCoordinator = new PeerRendezvousCoordinator(
            communicationChannel,
            config.role,
            1_000,
            (objective, currentPosition, excludedPositions) =>
                gridPositionSelector.select(
                    {
                        gameMap: beliefs.map,
                        agentPosition: currentPosition,
                        crates: beliefs.crates,
                        pathfinder,
                    },
                    objective,
                    excludedPositions,
                ),
        );
        const parcelHandoffCoordinator = new PeerParcelHandoffCoordinator(
            communicationChannel,
            config.role,
        );
        const agent = new Agent(
            beliefs,
            new DesireGenerator(),
            pathfinder,
            actionFactory,
            new ConsoleAgentLogger({
                branchAndBoundSvgEnabled: config.branchAndBoundSvgEnabled,
            }),
            rendezvousCoordinator,
            parcelHandoffCoordinator,
            usesLLM,
            usesLLM ? new MissionHandler(socket) : undefined,
        );
        const handshakeService = new PeerHandshakeService(
            communicationChannel,
            config.role,
            1_000,
            communicationLogger,
        );
        const ghostMapServer = new GhostMapServer(
            new AgentGhostMapSnapshotProvider(
                agent,
                beliefs,
                config.name,
            ),
            config.ghostMapPort,
        );

        return new AgentRuntime(
            config,
            socket,
            agent,
            beliefs,
            communicationChannel,
            handshakeService,
            rendezvousCoordinator,
            parcelHandoffCoordinator,
            ghostMapServer,
            new ConsoleAgentRuntimeLogger(),
        );
    }
}
