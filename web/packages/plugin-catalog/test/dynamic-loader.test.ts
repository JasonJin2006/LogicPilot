import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginCatalogEntry, PluginManifest } from '@logicpilot/contracts';
import {
  computePackageDigest,
  createDynamicEsmLoader,
  createDynamicWasmLoader,
  buildWasmImports,
} from '../src/index.js';

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

function fixture(): { root: string; entry: PluginCatalogEntry; manifest: PluginManifest } {
  // Keep the fixture under the Vite project root. Vite's test runner refuses
  // to resolve absolute files outside its project sandbox; production Node
  // imports still use the same file URL path.
  const root = mkdtempSync(join(process.cwd(), '.dynamic-loader-'));
  cleanups.push(root);
  const pkg = join(root, 'pkg');
  mkdirSync(pkg);
  const manifest = {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: 'logicpilot.dynamic',
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: { node: './activate.mjs' },
    permissions: [],
    trust: { minLevel: 't0' },
  } as PluginManifest;
  writeFileSync(
    join(pkg, 'activate.mjs'),
    'export function activate(ctx) { ctx.emit("dynamic.ready", { ok: true }); }',
  );
  writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
  const sha256 = computePackageDigest(pkg, manifest);
  return {
    root,
    manifest,
    entry: {
      id: manifest.id,
      scope: 'workspace',
      rootId: 'workspace:1',
      path: 'pkg',
      sha256,
      manifest,
    },
  };
}

describe('dynamic ESM loader', () => {
  it('verifies digest and lazily imports a node entrypoint', async () => {
    const { root, entry } = fixture();
    const loader = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
    });
    const thunk = loader(entry);
    expect(thunk).toBeDefined();
    const module = await thunk!();
    expect(module.activate).toBeTypeOf('function');
  });

  it('denies insufficient trust and rejects digest drift before import', () => {
    const { root, entry } = fixture();
    const denied: string[] = [];
    const loader = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't0',
      trustOverrides: new Map([[entry.id, 't0']]),
      onError: (error) => denied.push(error.code),
    });
    const strictEntry = {
      ...entry,
      manifest: { ...entry.manifest, trust: { minLevel: 't2' } },
    } as PluginCatalogEntry;
    expect(loader(strictEntry)).toBeUndefined();
    expect(denied).toContain('trust');

    const drifted = { ...entry, sha256: 'a'.repeat(64) };
    const integrityLoader = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      onError: (error) => denied.push(error.code),
    });
    expect(integrityLoader(drifted)).toBeUndefined();
    expect(denied).toContain('integrity');
  });

  it('enforces an activation timeout for dynamic ESM modules', async () => {
    const { root, entry, manifest } = fixture();
    writeFileSync(
      join(root, 'pkg', 'activate.mjs'),
      'export async function activate() { await new Promise((resolve) => setTimeout(resolve, 50)); }',
    );
    const refreshed = {
      ...entry,
      sha256: computePackageDigest(join(root, 'pkg'), manifest),
    };
    const thunk = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      activationTimeoutMs: 5,
    })(refreshed);
    await expect((await thunk!()).activate({} as never)).rejects.toMatchObject({ code: 'module' });
  });

  it('instantiates a capability-free WASM module with lifecycle exports', async () => {
    const root = mkdtempSync(join(process.cwd(), '.dynamic-wasm-'));
    cleanups.push(root);
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.dynamic-wasm',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { wasm: './module.wasm' },
      permissions: [],
      trust: { minLevel: 't0' },
    } as PluginManifest;
    writeFileSync(join(pkg, 'module.wasm'), wasmLifecycleModule());
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    const sha256 = computePackageDigest(pkg, manifest);
    const entry: PluginCatalogEntry = {
      id: manifest.id,
      scope: 'workspace',
      rootId: 'workspace:1',
      path: 'pkg',
      sha256,
      manifest,
    };
    const thunk = createDynamicWasmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't2',
    })(entry);
    expect(thunk).toBeDefined();
    const module = await thunk!();
    await module.activate({} as never);
    await module.deactivate?.();
  });
});

describe('WASM capability import table', () => {
  it('requires explicit capability grants before exposing imports', () => {
    expect(() => buildWasmImports(new Set(), { random_u32: () => 1 })).toThrow(/not granted/);
    const imports = buildWasmImports(new Set(['runtime.random']), { random_u32: () => 1 });
    expect(imports.logicpilot?.random_u32).toBeTypeOf('function');
  });
});

function wasmLifecycleModule(): Uint8Array {
  const name = new TextEncoder().encode('logicpilot_activate');
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    4,
    1,
    96,
    0,
    0, // () -> () type
    3,
    2,
    1,
    0, // one function using type 0
    7,
    23,
    1,
    name.length,
    ...name,
    0,
    0, // export function
    10,
    4,
    1,
    2,
    0,
    11, // empty function body
  ]);
}
