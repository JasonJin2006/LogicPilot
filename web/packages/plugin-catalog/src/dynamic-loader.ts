// Node-side dynamic ESM loader (Phase 2B-3 first slice). The browser never
// receives a filesystem path or imports a package directly; it consumes the
// already activated contributions through the host bridge.

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PermissionGrant } from '@logicpilot/contracts';
import type { PluginCatalogEntry, PluginModule, PluginScope } from '@logicpilot/plugin-host';
import type { PluginRootConfig } from './catalog.js';
import { computePackageDigest } from './catalog.js';
import { buildWasmImports, WASM_HOST_ABI, type WasmHostImports } from './wasm-abi.js';

export interface DynamicEsmLoaderOptions {
  readonly roots: readonly PluginRootConfig[];
  readonly scope: PluginScope;
  /** `node` is the only executable runtime enabled in this first slice. */
  readonly runtime?: 'node';
  readonly defaultTrustLevel?: 't0' | 't1' | 't2' | 't3' | 't4' | 't5';
  readonly trustOverrides?: ReadonlyMap<string, 't0' | 't1' | 't2' | 't3' | 't4' | 't5'>;
  readonly maxModuleBytes?: number;
  readonly activationTimeoutMs?: number;
  readonly isolate?: boolean;
  readonly onCapability?: (capability: string, payload: unknown) => void;
  readonly onCapabilityRequest?: (
    capability: string,
    payload: unknown,
  ) => unknown | Promise<unknown>;
  readonly grants?: readonly PermissionGrant[];
  readonly onError?: (error: DynamicEsmLoaderError) => void;
}

export class DynamicEsmLoaderError extends Error {
  constructor(
    message: string,
    readonly code: 'root' | 'path' | 'trust' | 'integrity' | 'module',
  ) {
    super(message);
    this.name = 'DynamicEsmLoaderError';
  }
}

const TRUST_ORDER = ['t0', 't1', 't2', 't3', 't4', 't5'] as const;

/** Creates a loader resolver suitable for
 * `RemoteCatalogDiscoverySource.resolveAsyncLoader`. It validates package
 * containment, trust and the manifest-bound digest before returning a lazy
 * import thunk. Unsupported entrypoint kinds are left to later loaders. */
export function createDynamicEsmLoader(
  options: DynamicEsmLoaderOptions,
): (entry: PluginCatalogEntry) => (() => Promise<PluginModule>) | undefined {
  const rootsById = new Map<string, string>();
  const counters = new Map<PluginScope, number>();
  for (const root of options.roots) {
    const index = (counters.get(root.scope) ?? 0) + 1;
    counters.set(root.scope, index);
    rootsById.set(`${root.scope}:${index}`, resolve(root.path));
  }
  const digestCache = new Map<string, string>();
  return (entry) => {
    if (entry.scope !== options.scope) return undefined;
    // Executable Node ESM always has a T4 floor even if a malformed or overly
    // permissive manifest declares a lower minimum.
    const minimum = highestTrust(entry.manifest.trust.minLevel, 't4');
    const effective = options.trustOverrides?.get(entry.id) ?? options.defaultTrustLevel ?? 't0';
    if (TRUST_ORDER.indexOf(effective) < TRUST_ORDER.indexOf(minimum)) {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' trust requirement denied`, 'trust'),
      );
      return undefined;
    }
    const relativeEntrypoint = entry.manifest.entrypoints.node;
    if (relativeEntrypoint === undefined) return undefined;
    const root = rootsById.get(entry.rootId);
    if (!root) {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' root is unavailable`, 'root'),
      );
      return undefined;
    }
    let packageDir: string;
    let modulePath: string;
    try {
      if (!isSafeRelative(entry.path) || !isSafeRelative(relativeEntrypoint))
        throw new Error('unsafe path');
      const packageCandidate = resolve(root, entry.path);
      packageDir = realpathSync(packageCandidate);
      if (!isWithin(root, packageDir) || !lstatSync(packageDir).isDirectory())
        throw new Error('package path');
      const moduleCandidate = resolve(packageCandidate, relativeEntrypoint);
      const moduleReal = realpathSync(moduleCandidate);
      if (!isWithin(packageDir, moduleReal) || !lstatSync(moduleReal).isFile())
        throw new Error('entrypoint path');
      // Keep the lexical path for import. Windows realpathSync may return an
      // 8.3 short name (JASONJ~1) that Vite's runner percent-encodes wrongly.
      modulePath = moduleCandidate;
      if (!/\.(?:mjs|cjs|js)$/i.test(modulePath)) throw new Error('unsupported module extension');
    } catch {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' entrypoint path is invalid`, 'path'),
      );
      return undefined;
    }
    const cacheKey = `${entry.id}@${entry.sha256.toLowerCase()}`;
    const knownDigest = digestCache.get(cacheKey);
    if (knownDigest === undefined) {
      try {
        const digest = computePackageDigest(packageDir, entry.manifest);
        if (digest !== entry.sha256.toLowerCase()) throw new Error('digest mismatch');
        digestCache.set(cacheKey, digest);
      } catch {
        report(
          options,
          new DynamicEsmLoaderError(`plugin '${entry.id}' integrity check failed`, 'integrity'),
        );
        return undefined;
      }
    }
    if (
      options.maxModuleBytes !== undefined &&
      statSync(modulePath).size > options.maxModuleBytes
    ) {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' module exceeds size limit`, 'path'),
      );
      return undefined;
    }
    const url = pathToFileURL(modulePath).href;
    return async () => {
      try {
        if (options.isolate) {
          const controller = createEsmWorkerController(modulePath, entry, {
            timeoutMs: options.activationTimeoutMs,
            onCapability: options.onCapability,
            onCapabilityRequest: options.onCapabilityRequest,
            grants: options.grants,
          });
          return {
            activate: (ctx) => controller.activate(ctx),
            deactivate: () => controller.deactivate(),
          } satisfies PluginModule;
        }
        // A URL fragment busts Node's ESM module cache on upgrade without
        // making Vite treat the absolute Windows path as a query resource.
        const namespace = (await import(
          /* @vite-ignore */ `${url}#lp=${encodeURIComponent(entry.sha256)}`
        )) as Record<string, unknown>;
        const candidate = namespace.default ?? namespace;
        if (!isPluginModule(candidate)) throw new Error('missing activate export');
        return {
          ...candidate,
          activate: (ctx) =>
            withTimeout(
              Promise.resolve(candidate.activate(ctx)),
              options.activationTimeoutMs,
              entry.id,
            ),
          ...(candidate.deactivate
            ? {
                deactivate: () =>
                  withTimeout(
                    Promise.resolve(candidate.deactivate?.()),
                    options.activationTimeoutMs,
                    entry.id,
                  ),
              }
            : {}),
        } satisfies PluginModule;
      } catch {
        throw new DynamicEsmLoaderError(`plugin '${entry.id}' module failed to load`, 'module');
      }
    };
  };
}

function createEsmWorkerController(
  modulePath: string,
  entry: PluginCatalogEntry,
  options: {
    readonly timeoutMs?: number;
    readonly onCapability?: (capability: string, payload: unknown) => void;
    readonly onCapabilityRequest?: (
      capability: string,
      payload: unknown,
    ) => unknown | Promise<unknown>;
    readonly grants?: readonly PermissionGrant[];
  },
): {
  activate(ctx: unknown): Promise<void>;
  deactivate(): Promise<void>;
} {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    let moduleValue;
    let activationContext;
    let effects = [];
    let rpcSequence = 0;
    const pending = new Map();
    function requestCapability(capability, payload) {
      const request = ++rpcSequence;
      return new Promise((resolve, reject) => {
        pending.set(request, { resolve, reject });
        parentPort.postMessage({ kind: 'capability-request', capability, payload, request });
      });
    }
    function rpcContext() {
      effects = [];
      return {
        pluginId: workerData.pluginId,
        manifest: workerData.manifest,
        grants: workerData.grants,
        service: (name) => ({ call: (...args) => requestCapability('runtime.service.call', { name, args }) }),
        emit: (event, payload) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.event.emit', payload: { event, payload } }),
        on: (event) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.event.subscribe', payload: { event } }),
        effect: (cleanup) => { if (typeof cleanup === 'function') effects.push(cleanup); },
        provide: (name, service) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.service.provide', payload: { name, methods: Object.keys(service || {}) } }),
      };
    }
    (async () => {
      try {
        const namespace = await import(workerData.url);
        moduleValue = namespace.default || namespace;
        if (!moduleValue || typeof moduleValue.activate !== 'function') throw new Error('missing-activate');
        parentPort.postMessage({ ok: true });
      } catch (error) {
        parentPort.postMessage({ ok: false });
      }
    })();
    parentPort.on('message', async (message) => {
      try {
        if (message.kind === 'capability-response') {
          const waiting = pending.get(message.request);
          if (waiting) {
            pending.delete(message.request);
            if (message.ok) waiting.resolve(message.payload);
            else waiting.reject(new Error('capability request failed'));
          }
          return;
        }
        if (!moduleValue) throw new Error('not-ready');
        if (message.kind === 'activate') {
          activationContext = rpcContext();
          await moduleValue.activate(activationContext);
        } else if (message.kind === 'deactivate' && typeof moduleValue.deactivate === 'function') {
          await moduleValue.deactivate();
        }
        if (message.kind === 'deactivate') {
          for (const cleanup of effects.reverse()) { try { cleanup(); } catch (_) {} }
        }
        parentPort.postMessage({ ok: true, request: message.request });
      } catch (error) {
        parentPort.postMessage({ ok: false, request: message.request });
      }
    });
  `;
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      url: `${pathToFileURL(modulePath).href}#lp=${encodeURIComponent(entry.sha256)}`,
      pluginId: entry.id,
      manifest: entry.manifest,
      grants: options.grants ?? [],
    },
  });
  worker.on('message', (value: unknown) => {
    const message = value as {
      readonly kind?: string;
      readonly capability?: string;
      readonly payload?: unknown;
      readonly request?: number;
    };
    if (message.kind === 'capability' && message.capability)
      options.onCapability?.(message.capability, message.payload);
    if (
      message.kind === 'capability-request' &&
      message.capability &&
      message.request !== undefined
    ) {
      const response = options.onCapabilityRequest
        ? Promise.resolve(options.onCapabilityRequest(message.capability, message.payload))
        : Promise.reject(new Error('capability broker unavailable'));
      response
        .then((payload) =>
          worker.postMessage({
            kind: 'capability-response',
            request: message.request,
            ok: true,
            payload,
          }),
        )
        .catch(() =>
          worker.postMessage({ kind: 'capability-response', request: message.request, ok: false }),
        );
    }
  });
  let readyResolve: (() => void) | null = null;
  let readyReject: (() => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  worker.once('message', (value: unknown) => {
    if ((value as { readonly ok?: boolean }).ok) readyResolve?.();
    else readyReject?.();
  });
  let request = 0;
  const call = (kind: 'activate' | 'deactivate'): Promise<void> => {
    const id = ++request;
    const result = new Promise<void>((resolveResult, rejectResult) => {
      const onMessage = (value: unknown) => {
        const message = value as {
          readonly ok?: boolean;
          readonly request?: number;
          readonly kind?: string;
        };
        if (message.kind !== undefined) return;
        if (message.request !== id) return;
        worker.off('message', onMessage);
        if (message.ok) resolveResult();
        else rejectResult(new DynamicEsmLoaderError('isolated ESM execution failed', 'module'));
      };
      worker.on('message', onMessage);
      worker.postMessage({ kind, request: id });
    });
    return withTimeout(result, options.timeoutMs, entry.id);
  };
  return {
    activate: async (ctx) => {
      void ctx;
      try {
        await ready;
        await call('activate');
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    },
    deactivate: async () => {
      try {
        await ready;
        await call('deactivate');
      } finally {
        await worker.terminate();
      }
    },
  };
}

export interface DynamicWasmLoaderOptions {
  readonly roots: readonly PluginRootConfig[];
  readonly scope: PluginScope;
  readonly defaultTrustLevel?: 't0' | 't1' | 't2' | 't3' | 't4' | 't5';
  readonly trustOverrides?: ReadonlyMap<string, 't0' | 't1' | 't2' | 't3' | 't4' | 't5'>;
  readonly maxWasmBytes?: number;
  readonly maxMemoryBytes?: number;
  readonly activationTimeoutMs?: number;
  readonly capabilities?: ReadonlySet<string>;
  readonly imports?: WasmHostImports;
  /** Run the WASM instance in a disposable Worker with hard termination. */
  readonly isolate?: boolean;
  readonly onCapability?: (capability: string, payload: unknown) => void;
  readonly onError?: (error: DynamicEsmLoaderError) => void;
}

/** Creates a deliberately capability-free WASM resolver. The module receives
 * no imports (therefore no filesystem/network/process access) and must expose
 * `logicpilot_activate(): void`, with optional `logicpilot_deactivate(): void`.
 * A richer host ABI belongs in a separate frozen contract. */
export function createDynamicWasmLoader(
  options: DynamicWasmLoaderOptions,
): (entry: PluginCatalogEntry) => (() => Promise<PluginModule>) | undefined {
  const rootsById = new Map<string, string>();
  const counters = new Map<PluginScope, number>();
  for (const root of options.roots) {
    const index = (counters.get(root.scope) ?? 0) + 1;
    counters.set(root.scope, index);
    rootsById.set(`${root.scope}:${index}`, resolve(root.path));
  }
  const digestCache = new Set<string>();
  const maxBytes = options.maxWasmBytes ?? 16 * 1024 * 1024;
  return (entry) => {
    if (entry.scope !== options.scope) return undefined;
    const effective = options.trustOverrides?.get(entry.id) ?? options.defaultTrustLevel ?? 't0';
    const minimum = highestTrust(entry.manifest.trust.minLevel, 't2');
    if (TRUST_ORDER.indexOf(effective) < TRUST_ORDER.indexOf(minimum)) {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' trust requirement denied`, 'trust'),
      );
      return undefined;
    }
    const relativeEntrypoint = entry.manifest.entrypoints.wasm;
    const root = rootsById.get(entry.rootId);
    if (relativeEntrypoint === undefined || root === undefined) return undefined;
    let packageDir: string;
    let wasmPath: string;
    try {
      if (!isSafeRelative(entry.path) || !isSafeRelative(relativeEntrypoint))
        throw new Error('unsafe path');
      const packageCandidate = resolve(root, entry.path);
      packageDir = realpathSync(packageCandidate);
      const wasmCandidate = resolve(packageCandidate, relativeEntrypoint);
      const wasmReal = realpathSync(wasmCandidate);
      if (!isWithin(root, packageDir) || !lstatSync(packageDir).isDirectory())
        throw new Error('package path');
      if (!isWithin(packageDir, wasmReal) || !lstatSync(wasmReal).isFile())
        throw new Error('wasm path');
      if (statSync(wasmReal).size > maxBytes) throw new Error('wasm size');
      wasmPath = wasmCandidate;
    } catch {
      report(
        options,
        new DynamicEsmLoaderError(`plugin '${entry.id}' WASM path is invalid`, 'path'),
      );
      return undefined;
    }
    const digestKey = `${entry.id}@${entry.sha256.toLowerCase()}`;
    if (!digestCache.has(digestKey)) {
      try {
        if (computePackageDigest(packageDir, entry.manifest) !== entry.sha256.toLowerCase())
          throw new Error('digest mismatch');
        digestCache.add(digestKey);
      } catch {
        report(
          options,
          new DynamicEsmLoaderError(`plugin '${entry.id}' integrity check failed`, 'integrity'),
        );
        return undefined;
      }
    }
    return async () => {
      try {
        if (options.isolate) {
          const controller = createWasmWorkerController(wasmPath, {
            maxMemoryBytes: options.maxMemoryBytes,
            timeoutMs: options.activationTimeoutMs,
            capabilities: options.capabilities,
            onCapability: options.onCapability,
          });
          return {
            activate: () => controller.activate(),
            deactivate: () => controller.deactivate(),
          } satisfies PluginModule;
        }
        const bytes = readFileSync(wasmPath);
        const instance = await withTimeout(
          WebAssembly.instantiate(bytes, buildWasmImports(options.capabilities, options.imports)),
          options.activationTimeoutMs,
          entry.id,
        );
        const exports = instance.instance.exports as Record<string, unknown>;
        if (
          typeof exports[WASM_HOST_ABI.abiVersionExport] !== 'function' ||
          (exports[WASM_HOST_ABI.abiVersionExport] as () => number)() !== WASM_HOST_ABI.abiVersion
        )
          throw new Error('unsupported ABI version');
        if (typeof exports[WASM_HOST_ABI.activateExport] !== 'function')
          throw new Error('missing activate export');
        const memoryBytes = (exports.memory as { buffer?: { byteLength?: unknown } } | undefined)
          ?.buffer?.byteLength;
        if (
          options.maxMemoryBytes !== undefined &&
          typeof memoryBytes === 'number' &&
          memoryBytes > options.maxMemoryBytes
        ) {
          throw new Error('WASM memory exceeds limit');
        }
        return {
          activate: () =>
            withTimeout(
              Promise.resolve((exports[WASM_HOST_ABI.activateExport] as () => void)()),
              options.activationTimeoutMs,
              entry.id,
            ),
          ...(typeof exports[WASM_HOST_ABI.deactivateExport] === 'function'
            ? {
                deactivate: () =>
                  withTimeout(
                    Promise.resolve((exports[WASM_HOST_ABI.deactivateExport] as () => void)()),
                    options.activationTimeoutMs,
                    entry.id,
                  ),
              }
            : {}),
        } satisfies PluginModule;
      } catch {
        throw new DynamicEsmLoaderError(
          `plugin '${entry.id}' WASM module failed to load`,
          'module',
        );
      }
    };
  };
}

function isPluginModule(value: unknown): value is PluginModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { activate?: unknown }).activate === 'function'
  );
}

function highestTrust(
  left: (typeof TRUST_ORDER)[number],
  right: (typeof TRUST_ORDER)[number],
): (typeof TRUST_ORDER)[number] {
  return TRUST_ORDER[Math.max(TRUST_ORDER.indexOf(left), TRUST_ORDER.indexOf(right))]!;
}

function isSafeRelative(value: string): boolean {
  const normalized = value.startsWith('./') ? value.slice(2) : value;
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.includes('\\') &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function report(options: DynamicEsmLoaderOptions, error: DynamicEsmLoaderError): void {
  try {
    options.onError?.(error);
  } catch {
    // Diagnostic observers are not allowed to break discovery.
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  pluginId: string,
): Promise<T> {
  if (timeoutMs === undefined) return promise;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(
      new DynamicEsmLoaderError(`plugin '${pluginId}' timeout is invalid`, 'module'),
    );
  }
  let timer: unknown;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new DynamicEsmLoaderError(`plugin '${pluginId}' activation timed out`, 'module')),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface WasmWorkerController {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

function createWasmWorkerController(
  wasmPath: string,
  options: {
    readonly maxMemoryBytes?: number;
    readonly timeoutMs?: number;
    readonly capabilities?: ReadonlySet<string>;
    readonly onCapability?: (capability: string, payload: unknown) => void;
  },
): WasmWorkerController {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs');
    let instance;
    function importsFor(capabilities) {
      const logicpilot = {};
      if (capabilities.includes('runtime.log')) logicpilot.log = (level, value) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.log', payload: { level, value } });
      if (capabilities.includes('runtime.random')) logicpilot.random_u32 = () => Math.floor(Math.random() * 0x100000000);
      return { logicpilot };
    }
    (async () => {
      try {
        const bytes = readFileSync(workerData.path);
        const result = await WebAssembly.instantiate(bytes, importsFor(workerData.capabilities));
        instance = result.instance;
        const memory = instance.exports.memory;
        const size = memory && memory.buffer ? memory.buffer.byteLength : 0;
        if (workerData.maxMemoryBytes && size > workerData.maxMemoryBytes) throw new Error('memory-limit');
        if (typeof instance.exports.logicpilot_abi_version !== 'function' || instance.exports.logicpilot_abi_version() !== 1) throw new Error('unsupported-abi');
        if (typeof instance.exports.logicpilot_activate !== 'function') throw new Error('missing-activate');
        parentPort.postMessage({ ok: true });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: String(error && error.message || error) });
      }
    })();
    parentPort.on('message', (message) => {
      try {
        if (!instance) throw new Error('not-ready');
        const fn = message.kind === 'activate' ? instance.exports.logicpilot_activate : instance.exports.logicpilot_deactivate;
        if (message.kind === 'activate' && typeof fn !== 'function') throw new Error('missing-activate');
        if (typeof fn === 'function') fn();
        parentPort.postMessage({ ok: true, request: message.request });
      } catch (error) {
        parentPort.postMessage({ ok: false, request: message.request, error: String(error && error.message || error) });
      }
    });
  `;
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      path: wasmPath,
      maxMemoryBytes: options.maxMemoryBytes,
      capabilities: [...(options.capabilities ?? [])],
    },
  });
  worker.on('message', (value: unknown) => {
    const message = value as {
      readonly kind?: string;
      readonly capability?: string;
      readonly payload?: unknown;
    };
    if (message.kind === 'capability' && message.capability)
      options.onCapability?.(message.capability, message.payload);
  });
  let request = 0;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    worker.once('message', (value: unknown) => {
      const message = value as { readonly ok?: boolean };
      if (message.ok) resolveReady();
      else
        rejectReady(
          new DynamicEsmLoaderError('isolated WASM worker failed to initialize', 'module'),
        );
    });
    worker.once('error', () =>
      rejectReady(new DynamicEsmLoaderError('isolated WASM worker failed', 'module')),
    );
  });
  const call = (kind: 'activate' | 'deactivate'): Promise<void> => {
    const id = ++request;
    const operation = new Promise<void>((resolveOperation, rejectOperation) => {
      const onMessage = (value: unknown) => {
        const message = value as {
          readonly ok?: boolean;
          readonly request?: number;
          readonly error?: string;
        };
        if (message.request !== undefined && message.request !== id) return;
        worker.off('message', onMessage);
        if (message.ok) resolveOperation();
        else rejectOperation(new DynamicEsmLoaderError('isolated WASM execution failed', 'module'));
      };
      worker.on('message', onMessage);
      worker.once('error', () =>
        rejectOperation(new DynamicEsmLoaderError('isolated WASM worker failed', 'module')),
      );
      worker.postMessage({ kind, request: id });
    });
    return withTimeout(operation, options.timeoutMs, 'isolated-wasm');
  };
  const ensureReady = (): Promise<void> => ready;
  return {
    activate: async () => {
      try {
        await ensureReady();
        await call('activate');
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    },
    deactivate: async () => {
      try {
        await ensureReady();
        await call('deactivate');
      } finally {
        await worker.terminate();
      }
    },
  };
}
