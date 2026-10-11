import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it.each(['import', 'execute'])('terminates a Worker stalled during %s', async (phase) => {
    const { root, entry, manifest } = fixture();
    writeFileSync(
      join(root, 'pkg', 'activate.mjs'),
      phase === 'import'
        ? 'while (true) {} export function activate() {}'
        : 'export function activate() {} export function execute() { while (true) {} }',
    );
    const thunk = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      isolate: true,
      activationTimeoutMs: 250,
    })({ ...entry, sha256: computePackageDigest(join(root, 'pkg'), manifest) });
    const module = await thunk!();
    if (phase === 'import')
      await expect(module.activate({} as never)).rejects.toMatchObject({ code: 'module' });
    else {
      await module.activate({} as never);
      await expect(module.execute!({} as never)).rejects.toMatchObject({ code: 'module' });
    }
  });
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

  it('runs ESM activation in a Worker and forwards capability messages', async () => {
    const { root, entry } = fixture();
    let emitted = 0;
    const thunk = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      isolate: true,
      onCapability: (capability) => {
        if (capability === 'runtime.event.emit') emitted += 1;
      },
    })(entry);
    const module = await thunk!();
    await module.activate({} as never);
    expect(emitted).toBe(1);
    await module.deactivate?.();
  });

  it('terminates a Worker running a synchronous infinite loop', async () => {
    const { root, entry, manifest } = fixture();
    writeFileSync(
      join(root, 'pkg', 'activate.mjs'),
      'export function activate() { while (true) {} }',
    );
    const loopEntry = {
      ...entry,
      sha256: computePackageDigest(join(root, 'pkg'), manifest),
    };
    const thunk = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      isolate: true,
      activationTimeoutMs: 25,
    })(loopEntry);
    const module = await thunk!();
    await expect(module.activate({} as never)).rejects.toMatchObject({ code: 'module' });
  });

  it('round-trips asynchronous service RPC through the worker boundary', async () => {
    const { root, entry, manifest } = fixture();
    writeFileSync(
      join(root, 'pkg', 'activate.mjs'),
      'export async function activate(ctx) { const result = await ctx.service("svc").call(2); if (result !== 42) throw new Error("bad result"); }',
    );
    const rpcEntry = { ...entry, sha256: computePackageDigest(join(root, 'pkg'), manifest) };
    const thunk = createDynamicEsmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      defaultTrustLevel: 't4',
      isolate: true,
      grants: [{ permissionId: 'runtime.service.call', granted: true }],
      onCapabilityRequest: (_capability, payload) => {
        expect(payload).toEqual({ name: 'svc', method: 'call', args: [2] });
        return 42;
      },
    })(rpcEntry);
    const module = await thunk!();
    await module.activate({} as never);
    await module.deactivate?.();
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
      isolate: true,
    })(entry);
    expect(thunk).toBeDefined();
    const module = await thunk!();
    await module.activate({} as never);
    await module.deactivate?.();
  });

  it('routes a declared Component entrypoint through the configured runner with the strict Rust RPC contract', async () => {
    const root = mkdtempSync(join(process.cwd(), '.dynamic-component-'));
    cleanups.push(root);
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    const report = join(pkg, 'report.json');
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.dynamic-component',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { component: './runner.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
    } as PluginManifest;
    // This mock mirrors the Rust runner's serde contract EXACTLY:
    // - argv[0] is the component path; flags follow (ignored here);
    // - every stdin line must parse as JSON, or the reader breaks;
    // - a line whose kind is not "capability-response" must deserialize as
    //   { id: u64, kind: string } - anything else is silently DROPPED (no
    //   reply), which is what hid broken frames when the mock echoed
    //   everything;
    // - unknown kinds answer {id, ok:false, error:'unknown-command'}.
    // On activate it first performs one capability round trip, exactly like a
    // component importing host-service would.
    writeFileSync(
      join(pkg, 'runner.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        'const report = { violations: [], frames: [], capabilityResponse: null };',
        'const reportPath = fileURLToPath(new URL("./report.json", import.meta.url));',
        'const save = () => writeFileSync(reportPath, JSON.stringify(report));',
        'const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");',
        'let buffer = "";',
        'let resolveCapability;',
        'const capabilityAnswered = new Promise((resolve) => { resolveCapability = resolve; });',
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => {",
        '  buffer += chunk;',
        '  let newline;',
        '  while ((newline = buffer.indexOf("\\n")) >= 0) {',
        '    const line = buffer.slice(0, newline).trim();',
        '    buffer = buffer.slice(newline + 1);',
        '    if (line) handle(line);',
        '  }',
        '});',
        'function handle(line) {',
        '  let value;',
        '  try { value = JSON.parse(line); } catch { process.exit(2); return; }',
        '  if (value.kind === "capability-response") {',
        '    if (!Number.isInteger(value.id) || value.id < 1) report.violations.push("capability response missing id");',
        '    report.capabilityResponse = value;',
        '    resolveCapability(value);',
        '    return;',
        '  }',
        '  if (!Number.isInteger(value.id) || value.id < 1 || typeof value.kind !== "string") {',
        '    report.violations.push("dropped malformed request: " + line);',
        '    return;',
        '  }',
        '  report.frames.push({ id: value.id, kind: value.kind });',
        '  if (value.kind === "activate") {',
        '    send({ kind: "capability-request", id: 1, capability: "runtime.log", operation: "write", payloadJson: JSON.stringify({ level: 1, value: 2 }) });',
        '    capabilityAnswered.then((response) => {',
        '      send({ id: value.id, ok: response && response.ok === true });',
        '      save();',
        '    });',
        '  } else if (value.kind === "deactivate") {',
        '    save();',
        '    send({ id: value.id, ok: true });',
        '  } else {',
        '    send({ id: value.id, ok: false, error: "unknown-command" });',
        '  }',
        '}',
      ].join('\n'),
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    const entry: PluginCatalogEntry = {
      id: manifest.id,
      scope: 'workspace',
      rootId: 'workspace:1',
      path: 'pkg',
      sha256: computePackageDigest(pkg, manifest),
      manifest,
    };
    const invoked: Array<{ capability: string; payload: unknown }> = [];
    const thunk = createDynamicWasmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      componentRunner: process.execPath,
      activationTimeoutMs: 5_000,
      // The Component floor is T2: below it the loader must refuse the entry.
      defaultTrustLevel: 't2',
      capabilities: new Set(['runtime.log']),
      onCapabilityRequest: (capability, payload) => {
        invoked.push({ capability, payload });
        return { echoed: payload };
      },
    })(entry);
    const module = await thunk!();
    await module.activate({} as never);
    await module.deactivate?.();
    const observed = JSON.parse(readFileSync(report, 'utf8')) as {
      violations: string[];
      frames: { id: number; kind: string }[];
      capabilityResponse: { id: number; ok: boolean; payloadJson: string };
    };
    // Every lifecycle frame carried the id the Rust Request struct requires.
    expect(observed.violations).toEqual([]);
    expect(observed.frames).toEqual([
      { id: 1, kind: 'activate' },
      { id: 2, kind: 'deactivate' },
    ]);
    // The capability round trip matched the Rust notification/response shape.
    expect(observed.capabilityResponse.id).toBe(1);
    expect(observed.capabilityResponse.ok).toBe(true);
    expect(JSON.parse(observed.capabilityResponse.payloadJson)).toEqual({
      echoed: { level: 1, value: 2 },
    });
    // The host broker saw the exact capability + payload the component sent.
    expect(invoked).toEqual([{ capability: 'runtime.log', payload: { level: 1, value: 2 } }]);
  });

  it('denies a Component entrypoint below the T2 trust floor', () => {
    const root = mkdtempSync(join(process.cwd(), '.dynamic-component-trust-'));
    cleanups.push(root);
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.dynamic-component',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { component: './runner.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
    } as PluginManifest;
    writeFileSync(join(pkg, 'runner.mjs'), 'export {};\n');
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    const entry: PluginCatalogEntry = {
      id: manifest.id,
      scope: 'workspace',
      rootId: 'workspace:1',
      path: 'pkg',
      sha256: computePackageDigest(pkg, manifest),
      manifest,
    };
    const errors: string[] = [];
    for (const defaultTrustLevel of ['t0', 't1'] as const) {
      const thunk = createDynamicWasmLoader({
        roots: [{ scope: 'workspace', path: root }],
        scope: 'workspace',
        componentRunner: process.execPath,
        defaultTrustLevel,
        onError: (error) => errors.push(error.message),
      })(entry);
      expect(thunk).toBeUndefined();
    }
    expect(errors.filter((message) => /trust requirement denied/.test(message))).toHaveLength(2);
  });

  it('times out and reclaims the runner process when the runner never responds', async () => {
    const root = mkdtempSync(join(process.cwd(), '.dynamic-component-timeout-'));
    cleanups.push(root);
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    const report = join(pkg, 'report.json');
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.dynamic-component',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { component: './runner.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
    } as PluginManifest;
    // This runner receives the activate command, records it with its own pid,
    // and then never answers - the controller must time out AND kill it.
    writeFileSync(
      join(pkg, 'runner.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        'const reportPath = fileURLToPath(new URL("./report.json", import.meta.url));',
        'let buffer = "";',
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => {",
        '  buffer += chunk;',
        '  const newline = buffer.indexOf("\\n");',
        '  if (newline >= 0) {',
        '    const line = buffer.slice(0, newline).trim();',
        '    if (line) writeFileSync(reportPath, JSON.stringify({ pid: process.pid, frame: JSON.parse(line) }));',
        '    // Never respond: the lifecycle hangs until the timeout reclaims us.',
        '  }',
        '});',
      ].join('\n'),
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    const entry: PluginCatalogEntry = {
      id: manifest.id,
      scope: 'workspace',
      rootId: 'workspace:1',
      path: 'pkg',
      sha256: computePackageDigest(pkg, manifest),
      manifest,
    };
    const thunk = createDynamicWasmLoader({
      roots: [{ scope: 'workspace', path: root }],
      scope: 'workspace',
      componentRunner: process.execPath,
      activationTimeoutMs: 250,
      defaultTrustLevel: 't2',
    })(entry);
    const module = await thunk!();
    await expect(module.activate({} as never)).rejects.toThrow(/timed out/);
    const observed = JSON.parse(readFileSync(report, 'utf8')) as {
      pid: number;
      frame: { id: number; kind: string };
    };
    // The frame the real Rust runner would have required: id + kind.
    expect(observed.frame.kind).toBe('activate');
    expect(observed.frame.id).toBeGreaterThanOrEqual(1);
    // The timed-out runner process must actually be dead.
    const deadline = Date.now() + 8_000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(observed.pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);
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
  const abi = new TextEncoder().encode('logicpilot_abi_version');
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
    8,
    2,
    96,
    0,
    1,
    127,
    96,
    0,
    0, // () -> i32 ABI version and () -> () lifecycle types
    3,
    3,
    2,
    0,
    1, // ABI version and lifecycle function types
    7,
    48,
    2,
    abi.length,
    ...abi,
    0,
    0,
    name.length,
    ...name,
    0,
    1, // export ABI version and lifecycle
    10,
    9,
    2,
    4,
    0,
    65,
    1,
    11,
    2,
    0,
    11, // i32.const 1; empty body
  ]);
}
