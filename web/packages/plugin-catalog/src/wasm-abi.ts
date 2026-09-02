// Frozen WASM host ABI v1. The table is intentionally small and declarative:
// an import is available only when the caller explicitly grants its capability.

export const WASM_HOST_ABI_VERSION = 1 as const;

export const WASM_CAPABILITY_IMPORTS = {
  log: { capability: 'runtime.log', params: ['i32', 'i32'], result: 'void' },
  random_u32: { capability: 'runtime.random', params: [], result: 'i32' },
} as const;

export type WasmImportName = keyof typeof WASM_CAPABILITY_IMPORTS;
export type WasmCapabilityId = (typeof WASM_CAPABILITY_IMPORTS)[WasmImportName]['capability'];

export interface WasmHostImports {
  readonly log?: (level: number, value: number) => void;
  readonly random_u32?: () => number;
}

export function buildWasmImports(
  capabilities: ReadonlySet<string> = new Set(),
  provided: WasmHostImports = {},
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const namespace: Record<string, unknown> = {};
  for (const name of Object.keys(WASM_CAPABILITY_IMPORTS) as WasmImportName[]) {
    const descriptor = WASM_CAPABILITY_IMPORTS[name];
    const implementation = provided[name];
    if (implementation !== undefined) {
      if (!capabilities.has(descriptor.capability)) {
        throw new Error(`WASM capability '${descriptor.capability}' was not granted`);
      }
      namespace[name] = implementation;
    }
  }
  return { logicpilot: namespace };
}
