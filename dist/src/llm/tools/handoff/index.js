/**
 * Parcel handoff — survivable route selection and peer transfer coordination.
 *
 * Directory structure:
 * ├── _selector.ts     # Selects balanced, survivable parcel transfer routes
 * ├── _coordinator.ts  # Executes the reliable two-agent handoff state machine
 * └── _objective.ts    # Typed intention for one committed protocol segment
 */
export { BalancedSurvivableParcelHandoffCandidateSelector, BaseParcelHandoffCandidateSelector, } from "./_selector.js";
export { BaseParcelHandoffCoordinator, PARCEL_HANDOFF_STATE, PeerParcelHandoffCoordinator, } from "./_coordinator.js";
export { ParcelHandoffIntention } from "./_objective.js";
//# sourceMappingURL=index.js.map