/**
 * Rendezvous tool — map-aware target selection for level-3 missions.
 *
 * Directory structure:
 * ├── _coordinator.ts # Peer protocol state and mutual-arrival barrier
 * ├── _objective.ts  # Validated rendezvous request extracted by the LLM
 * └── _selector.ts   # Abstract selector and reachable-cell implementation
 */

export {
    RendezvousObjective,
} from "./_objective.js";
export {
    BaseRendezvousPositionSelector,
    ReachableRendezvousPositionSelector,
    type RendezvousPositionSelection,
} from "./_selector.js";
export {
    BaseRendezvousCoordinator,
    PeerRendezvousCoordinator,
    RENDEZVOUS_COORDINATION_STATE,
    type RendezvousCoordinationPlan,
    type RendezvousCoordinationSnapshot,
    type RendezvousStateChangeHandler,
} from "./_coordinator.js";
