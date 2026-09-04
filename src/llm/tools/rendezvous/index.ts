/**
 * Rendezvous tool — map-aware target selection for level-3 missions.
 *
 * Directory structure:
 * ├── _coordinator.ts # Peer protocol state and mutual-arrival barrier
 * ├── _objective.ts  # Validated rendezvous request extracted by the LLM
 * ├── _position-objective.ts # Exact, parity, and wildcard cell predicates
 * └── _selector.ts   # Abstract selector and reachable-cell implementation
 */

export {
    RendezvousObjective,
} from "./_objective.js";
export {
    GRID_COORDINATE_PARITY,
    GridPositionObjective,
    type GridCoordinateObjective,
    type GridPositionObjectiveDescription,
} from "./_position-objective.js";
export {
    BaseGridPositionSelector,
    BaseRendezvousPositionSelector,
    ReachableGridPositionSelector,
    ReachableRendezvousPositionSelector,
    type GridPositionSelectionContext,
    type RendezvousPositionSelection,
} from "./_selector.js";
export {
    BaseRendezvousCoordinator,
    PeerRendezvousCoordinator,
    RENDEZVOUS_COORDINATION_STATE,
    type GridFormationCoordinationPlan,
    type GridPositionResolutionHandler,
    type RendezvousCoordinationPlan,
    type RendezvousCoordinationSnapshot,
    type RendezvousStateChangeHandler,
} from "./_coordinator.js";
