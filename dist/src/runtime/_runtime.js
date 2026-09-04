import { AGENT_EXIT_REASON } from "../agent.js";
/** Owns the socket listeners and lifecycle of one physical agent. */
export class AgentRuntime {
    constructor(runtimeConfig, socket, agent, beliefs, communicationChannel, handshakeService, rendezvousCoordinator, parcelHandoffCoordinator, ghostMapServer, logger) {
        this.runtimeConfig = runtimeConfig;
        this.socket = socket;
        this.agent = agent;
        this.beliefs = beliefs;
        this.communicationChannel = communicationChannel;
        this.handshakeService = handshakeService;
        this.rendezvousCoordinator = rendezvousCoordinator;
        this.parcelHandoffCoordinator = parcelHandoffCoordinator;
        this.ghostMapServer = ghostMapServer;
        this.logger = logger;
        this.started = false;
    }
    /** Registers every listener before connecting and starts the agent loop. */
    start() {
        if (this.started) {
            throw new Error(`Agent runtime ${this.runtimeConfig.name} is already started`);
        }
        this.started = true;
        this.registerSocketListeners();
        this.communicationChannel.start((sender, message) => this.handleUnhandledMessage(sender, message));
        this.handshakeService.start();
        this.rendezvousCoordinator.start();
        this.parcelHandoffCoordinator.start();
        this.socket.connect();
        this.startGhostMap();
        this.startAgentLoop();
    }
    registerSocketListeners() {
        this.socket.onConnect(() => {
            this.logger.log({
                event: "connected",
                agentName: this.runtimeConfig.name,
            });
        });
        this.socket.onConfig((config) => {
            this.beliefs.configPhase(config);
        });
        this.socket.onYou((agentState) => {
            if (!this.agent.id) {
                this.agent.id = agentState.id;
            }
            this.agent.updateScore(agentState.score);
            if (agentState.x !== undefined
                && agentState.y !== undefined) {
                this.agent.updatePosition(agentState.x, agentState.y);
            }
        });
        this.socket.onSensing((sensing) => {
            const revision = this.beliefs.reviseWithChanges(sensing.parcels, sensing.crates, sensing.positions, sensing.agents);
            this.agent.signalBeliefRevision(revision);
        });
    }
    handleUnhandledMessage(sender, message) {
        if (!this.agent.usesLLM() || typeof message !== "string") {
            return;
        }
        this.agent.handleMsgFromChat(sender.id, sender.name, message);
    }
    startGhostMap() {
        void this.ghostMapServer.start()
            .then(() => {
            this.logger.log({
                event: "ghost-map-ready",
                agentName: this.runtimeConfig.name,
                port: this.runtimeConfig.ghostMapPort,
            });
        })
            .catch((error) => {
            this.logger.log({
                event: "ghost-map-failed",
                agentName: this.runtimeConfig.name,
                error,
            });
        });
    }
    startAgentLoop() {
        void this.agent.agent_loop()
            .then(async (exitReason) => {
            if (exitReason === AGENT_EXIT_REASON.NO_FEASIBLE_PLAN) {
                this.logger.log({
                    event: "no-feasible-plan",
                    agentName: this.runtimeConfig.name,
                });
                await this.stop();
            }
        })
            .catch(async (error) => {
            this.logger.log({
                event: "runtime-crashed",
                agentName: this.runtimeConfig.name,
                error,
            });
            await this.stop();
            process.exitCode = 1;
        });
    }
    async stop() {
        this.handshakeService.stop();
        this.rendezvousCoordinator.stop();
        this.parcelHandoffCoordinator.stop();
        this.socket.disconnect();
        await this.ghostMapServer.stop();
    }
}
//# sourceMappingURL=_runtime.js.map