// @logicpilot/protocol — public entry point.
//
// Re-exports the flatc-generated bindings for the frozen contracts:
//   * schemas/ir_v2.fbs (F1: thin Node/SemanticsRef IR, "LP2R")
//   * schemas/wire.fbs  (F2: WS realtime frame protocol, "LPWR")
//
// The generated files live under ./generated and are produced by
// `pnpm codegen` (root) / cmake target logicpilot_codegen_ts. Do not edit
// them by hand.

export * from './generated/logicpilot/ir/v2/model-file.js';
export * from './generated/logicpilot/ir/v2/node.js';
export * from './generated/logicpilot/ir/v2/semantics-ref.js';
export * from './generated/logicpilot/ir/v2/var.js';
export * from './generated/logicpilot/ir/v2/var-type.js';
export * from './generated/logicpilot/ir/v2/port.js';
export * from './generated/logicpilot/ir/v2/port-direction.js';
export * from './generated/logicpilot/ir/v2/statechart.js';
export * from './generated/logicpilot/ir/v2/state.js';
export * from './generated/logicpilot/ir/v2/transition.js';
export * from './generated/logicpilot/ir/v2/trigger-kind.js';
export * from './generated/logicpilot/ir/v2/action.js';
export * from './generated/logicpilot/ir/v2/behavior-binding.js';
export * from './generated/logicpilot/ir/v2/coupling.js';
export * from './generated/logicpilot/ir/v2/distribution.js';
export * from './generated/logicpilot/ir/v2/metadata.js';
export * from './generated/logicpilot/ir/v2/equation.js';
export * from './generated/logicpilot/ir/v2/experiment.js';
export * from './generated/logicpilot/ir/v2/experiment-kind.js';
export * from './generated/logicpilot/ir/v2/source-span.js';
export * from './generated/logicpilot/wire.js';
