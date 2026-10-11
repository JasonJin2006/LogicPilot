// TypeScript projection of schemas/wasm/logicpilot-plugin.wit (ABI v1).
// The desktop shell generates the authoritative Rust projection with
// wit-bindgen; this TS projection keeps the Node raw-WASM bridge wire-compatible
// during migration to Component Model instantiation.

export interface LogicPilotWasmExports {
  readonly logicpilot_abi_version: () => number;
  readonly logicpilot_activate: () => void;
  readonly logicpilot_deactivate?: () => void;
}

export interface LogicPilotWasmHostImports {
  readonly log?: (level: number, value: number) => void;
  readonly random_u32?: () => number;
}

/** TypeScript projection of the WIT host-service interface. This keeps the
 * broker wire shape stable until wit-bindgen is available in the build image.
 */
export interface LogicPilotWasmCapabilityRequest {
  readonly capability: string;
  readonly operation: string;
  readonly payloadJson: string;
}

export interface LogicPilotWasmCapabilityResponse {
  readonly ok: boolean;
  readonly payloadJson: string;
  readonly errorCode?: string;
}

export interface LogicPilotWasmHostService {
  readonly invoke: (
    request: LogicPilotWasmCapabilityRequest,
  ) => LogicPilotWasmCapabilityResponse | Promise<LogicPilotWasmCapabilityResponse>;
}

export const LOGICPILOT_WASM_ABI_VERSION = 1 as const;
