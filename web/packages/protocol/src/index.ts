// @logicpilot/protocol — public entry point.
//
// Re-exports the flatc-generated bindings for the frozen contracts:
//   * schemas/ir.fbs   (F1: Extended DEVS IR v1, file_identifier "LPIR")
//   * schemas/wire.fbs (F2: WS realtime frame protocol v1, "LPWR")
//
// The generated files live under ./generated and are produced by
// `pnpm codegen` (root) / cmake target logicpilot_codegen_ts. Do not edit
// them by hand.

export * from './generated/logicpilot/ir.js';
export * from './generated/logicpilot/wire.js';

// IR v2 contract (schemas/ir_v2.fbs, "LP2R"): thin Node / SemanticsRef
// container. Aliased with a V2 suffix to avoid name clashes with the frozen
// v1 bindings above.
export { ModelFile as ModelFileV2 } from './generated/logicpilot/ir/v2/model-file.js';
export { Node as NodeV2 } from './generated/logicpilot/ir/v2/node.js';
export { SemanticsRef as SemanticsRefV2 } from './generated/logicpilot/ir/v2/semantics-ref.js';
export { Var as VarV2 } from './generated/logicpilot/ir/v2/var.js';
export { VarType as VarTypeV2 } from './generated/logicpilot/ir/v2/var-type.js';
export { Port as PortV2 } from './generated/logicpilot/ir/v2/port.js';
export { PortDirection as PortDirectionV2 } from './generated/logicpilot/ir/v2/port-direction.js';
export { Statechart as StatechartV2 } from './generated/logicpilot/ir/v2/statechart.js';
export { State as StateV2 } from './generated/logicpilot/ir/v2/state.js';
export { Transition as TransitionV2 } from './generated/logicpilot/ir/v2/transition.js';
export { TriggerKind as TriggerKindV2 } from './generated/logicpilot/ir/v2/trigger-kind.js';
export { Action as ActionV2 } from './generated/logicpilot/ir/v2/action.js';
export { BehaviorBinding as BehaviorBindingV2 } from './generated/logicpilot/ir/v2/behavior-binding.js';
export { Coupling as CouplingV2 } from './generated/logicpilot/ir/v2/coupling.js';
export { Distribution as DistributionV2 } from './generated/logicpilot/ir/v2/distribution.js';
export { Metadata as MetadataV2 } from './generated/logicpilot/ir/v2/metadata.js';
