import type { WasmHostAbi } from '@logicpilot/contracts';

// Frozen WASM host ABI v1. The table is intentionally small and declarative:
// an import is available only when the caller explicitly grants its capability.

export const WASM_HOST_ABI_VERSION = 1 as const;

const ABI_IMPORTS = [
  {
    name: 'log',
    capability: 'runtime.log',
    permissionId: 'runtime.wasm.build',
    params: ['i32', 'i32'],
    result: 'void',
  },
  {
    name: 'random_u32',
    capability: 'runtime.random',
    permissionId: 'runtime.wasm.build',
    params: [],
    result: 'i32',
  },
] as const;

export const WASM_HOST_ABI: WasmHostAbi = {
  schema: 'logicpilot.wasm-host-abi/v1',
  contractVersion: 1,
  abiVersion: WASM_HOST_ABI_VERSION,
  imports: ABI_IMPORTS,
  abiVersionExport: 'logicpilot_abi_version',
  activateExport: 'logicpilot_activate',
  deactivateExport: 'logicpilot_deactivate',
};

export const WASM_CAPABILITY_IMPORTS = {
  log: ABI_IMPORTS[0],
  random_u32: ABI_IMPORTS[1],
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
