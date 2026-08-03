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
