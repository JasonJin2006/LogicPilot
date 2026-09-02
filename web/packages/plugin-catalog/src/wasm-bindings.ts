// TypeScript projection of schemas/wasm/logicpilot-plugin.wit (ABI v1).
// The core-WASM adapter uses these names directly; Component Model codegen
// can replace this file without changing CapabilityBroker or PluginHost.

export interface LogicPilotWasmExports {
  readonly logicpilot_abi_version: () => number;
  readonly logicpilot_activate: () => void;
  readonly logicpilot_deactivate?: () => void;
}

export interface LogicPilotWasmHostImports {
  readonly log?: (level: number, value: number) => void;
  readonly random_u32?: () => number;
}

export const LOGICPILOT_WASM_ABI_VERSION = 1 as const;
