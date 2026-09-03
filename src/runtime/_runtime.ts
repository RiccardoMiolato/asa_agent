import type { DjsClientSocket } from "@unitn-asa/deliveroo-js-sdk/client";
import { Agent, AGENT_EXIT_REASON } from "../agent.js";
import { GhostMapServer } from "../_ghost-map-server.js";
import type { Beliefs } from "../bdi/beliefs.js";
import {
    BaseAgentCommunicationChannel,
    type AgentCommunicationPeer,
    PeerHandshakeService,
} from "../communication/index.js";
import type { IOAgent } from "../../types/IOAgent.js";
import type { IOConfig } from "../../types/IOConfig.js";
import type { IOSensing } from "../../types/IOSensing.js";
import type { AgentRuntimeConfig } from "./_config.js";
import type { BaseAgentRuntimeLogger } from "./_logging.js";
import type { BaseRendezvousCoordinator } from "../llm/tools/rendezvous/index.js";

/** Owns the socket listeners and lifecycle of one physical agent. */
export class AgentRuntime {
    private started: boolean = false;

    constructor(
        private readonly runtimeConfig: AgentRuntimeConfig,
        private readonly socket: DjsClientSocket,
        private readonly agent: Agent,
        private readonly beliefs: Beliefs,
        private readonly communicationChannel:
            BaseAgentCommunicationChannel,
        private readonly handshakeService: PeerHandshakeService,
        private readonly rendezvousCoordinator: BaseRendezvousCoordinator,
        private readonly ghostMapServer: GhostMapServer,
        private readonly logger: BaseAgentRuntimeLogger,
    ) { }

    /** Registers every listener before connecting and starts the agent loop. */
    start(): void {
        if (this.started) {
            throw new Error(
                `Agent runtime ${this.runtimeConfig.name} is already started`,
            );
        }
        this.started = true;
        this.registerSocketListeners();
        this.communicationChannel.start(
            (
                sender: AgentCommunicationPeer,
                message: unknown,
            ): void => this.handleUnhandledMessage(sender, message),
        );
        this.handshakeService.start();
        this.rendezvousCoordinator.start();
        this.socket.connect();
        this.startGhostMap();
        this.startAgentLoop();
    }

    private registerSocketListeners(): void {
        this.socket.onConnect((): void => {
            this.logger.log({
                event: "connected",
                agentName: this.runtimeConfig.name,
            });
        });
        this.socket.onConfig((config: IOConfig): void => {
            this.beliefs.configPhase(config);
        });
        this.socket.onYou((agentState: IOAgent): void => {
            if (!this.agent.id) {
                this.agent.id = agentState.id;
            }
            this.agent.updateScore(agentState.score);
            if (
                agentState.x !== undefined
                && agentState.y !== undefined
            ) {
                this.agent.updatePosition(agentState.x, agentState.y);
            }
        });
        this.socket.onSensing((sensing: IOSensing): void => {
            const revision = this.beliefs.reviseWithChanges(
                sensing.parcels,
                sensing.crates,
                sensing.positions,
                sensing.agents,
            );
            this.agent.signalBeliefRevision(revision);
        });
    }

    private handleUnhandledMessage(
        sender: AgentCommunicationPeer,
        message: unknown,
    ): void {
        if (!this.agent.usesLLM() || typeof message !== "string") {
            return;
        }
        this.agent.handleMsgFromChat(sender.id, sender.name, message);
    }

    private startGhostMap(): void {
        void this.ghostMapServer.start()
            .then((): void => {
                this.logger.log({
                    event: "ghost-map-ready",
                    agentName: this.runtimeConfig.name,
                    port: this.runtimeConfig.ghostMapPort,
                });
            })
            .catch((error: unknown): void => {
                this.logger.log({
                    event: "ghost-map-failed",
                    agentName: this.runtimeConfig.name,
                    error,
                });
            });
    }

    private startAgentLoop(): void {
        void this.agent.agent_loop()
            .then(
                async (exitReason: AGENT_EXIT_REASON): Promise<void> => {
                    if (exitReason === AGENT_EXIT_REASON.NO_FEASIBLE_PLAN) {
                        this.logger.log({
                            event: "no-feasible-plan",
                            agentName: this.runtimeConfig.name,
                        });
                        await this.stop();
                    }
                },
            )
            .catch(async (error: unknown): Promise<void> => {
                this.logger.log({
                    event: "runtime-crashed",
                    agentName: this.runtimeConfig.name,
                    error,
                });
                await this.stop();
                process.exitCode = 1;
            });
    }

    private async stop(): Promise<void> {
        this.handshakeService.stop();
        this.rendezvousCoordinator.stop();
        this.socket.disconnect();
        await this.ghostMapServer.stop();
    }
}
