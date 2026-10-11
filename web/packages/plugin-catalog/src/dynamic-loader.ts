// Node-side dynamic ESM loader (Phase 2B-3 first slice). The browser never
// receives a filesystem path or imports a package directly; it consumes the
// already activated contributions through the host bridge.

import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { createComponentRunnerController } from './component-runner.js';
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
            execute: (request) => controller.execute(request),
            callService: (name, method, args) => controller.callService(name, method, args),
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
          ...(typeof candidate.execute === 'function'
            ? {
                execute: (request) =>
                  withTimeout(
                    Promise.resolve(candidate.execute?.(request)),
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
  execute(request: unknown): Promise<unknown>;
  callService(name: string, method: string, args: readonly unknown[]): Promise<unknown>;
} {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    let moduleValue;
    let activationContext;
    let effects = [];
    const provided = new Map();
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
        service: (name) => new Proxy({}, {
          get(_target, method) {
            if (typeof method !== 'string' || method === 'then' || method === 'toJSON') return undefined;
            return (...args) => requestCapability('runtime.service.call', { name, method, args });
          },
        }),
        emit: (event, payload) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.event.emit', payload: { event, payload } }),
        on: (event) => parentPort.postMessage({ kind: 'capability', capability: 'runtime.event.subscribe', payload: { event } }),
        effect: (cleanup) => { if (typeof cleanup === 'function') effects.push(cleanup); },
        provide: (name, service) => requestCapability('runtime.service.provide', { name, methods: Object.keys(service || {}) })
          .then(() => { provided.set(name, service); return { ok: true, methods: Object.keys(service || {}) }; })
          .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) })),
      };
    }
    (async () => {
      try {
        const namespace = await import(workerData.url);
        moduleValue = namespace.default || namespace;
        if (!moduleValue || typeof moduleValue.activate !== 'function') throw new Error('missing-activate');
        if (workerData.manifest.executionTargets?.length && typeof moduleValue.execute !== 'function')
          throw new Error('missing-execute');
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
            else waiting.reject(new Error(message.errorCode ?? 'capability request failed'));
          }
          return;
        }
        if (!moduleValue) throw new Error('not-ready');
        let result;
        if (message.kind === 'activate') {
          activationContext = rpcContext();
          await moduleValue.activate(activationContext);
        } else if (message.kind === 'deactivate' && typeof moduleValue.deactivate === 'function') {
          await moduleValue.deactivate();
        } else if (message.kind === 'execute' && typeof moduleValue.execute === 'function') {
          result = await moduleValue.execute(message.payload);
        } else if (message.kind === 'execute') {
          throw new Error('missing-execute');
        } else if (message.kind === 'service-call') {
          const payload = message.payload || {};
          const service = provided.get(payload.name);
          if (!service) throw new Error('service not provided by this plugin');
          const fn = service[payload.method];
          if (typeof fn !== 'function') throw new Error('service method not found');
          result = await fn(...(payload.args || []));
        }
        if (message.kind === 'deactivate') {
          for (const cleanup of effects.reverse()) { try { cleanup(); } catch (_) {} }
          provided.clear();
        }
        parentPort.postMessage({ ok: true, request: message.request, result });
      } catch (error) {
        parentPort.postMessage({
          ok: false,
          request: message.request,
          errorCode: error instanceof Error ? error.message : String(error),
        });
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
        .catch((reason) =>
          worker.postMessage({
            kind: 'capability-response',
            request: message.request,
            ok: false,
            errorCode: reason instanceof Error ? reason.message : undefined,
          }),
        );
    }
  });
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  worker.once('message', (value: unknown) => {
    if ((value as { readonly ok?: boolean }).ok) readyResolve?.();
    else readyReject?.(new DynamicEsmLoaderError('isolated ESM initialization failed', 'module'));
  });
  worker.on('error', () =>
    readyReject?.(new DynamicEsmLoaderError('isolated ESM worker failed', 'module')),
  );
  worker.on('exit', () =>
    readyReject?.(new DynamicEsmLoaderError('isolated ESM worker exited', 'module')),
  );
  let request = 0;
  let terminated = false;
  const terminateWorker = async () => {
    if (terminated) return;
    terminated = true;
    await worker.terminate();
  };
  const call = (
    kind: 'activate' | 'deactivate' | 'execute' | 'service-call',
    payload?: unknown,
  ): Promise<unknown> => {
    if (terminated)
      return Promise.reject(new DynamicEsmLoaderError('isolated ESM worker stopped', 'module'));
    const id = ++request;
    let cleanup = () => {};
    const result = new Promise<unknown>((resolveResult, rejectResult) => {
      const onMessage = (value: unknown) => {
        const message = value as {
          readonly ok?: boolean;
          readonly request?: number;
          readonly kind?: string;
          readonly result?: unknown;
          readonly errorCode?: string;
        };
        if (message.kind !== undefined) return;
        if (message.request !== id) return;
        worker.off('message', onMessage);
        if (message.ok) resolveResult(message.result);
        else
          rejectResult(
            new DynamicEsmLoaderError(
              message.errorCode ?? 'isolated ESM execution failed',
              'module',
            ),
          );
      };
      const onFailure = () =>
        rejectResult(new DynamicEsmLoaderError('isolated ESM worker stopped', 'module'));
      cleanup = () => {
        worker.off('message', onMessage);
        worker.off('error', onFailure);
        worker.off('exit', onFailure);
      };
      worker.on('message', onMessage);
      worker.once('error', onFailure);
      worker.once('exit', onFailure);
      worker.postMessage({ kind, request: id, payload });
    });
    return withTimeout(result, timeoutFor(kind, payload, options.timeoutMs), entry.id).finally(() =>
      cleanup(),
    );
  };
  return {
    activate: async (ctx) => {
      void ctx;
      try {
        await withTimeout(ready, options.timeoutMs, entry.id);
        await call('activate');
      } catch (error) {
        await terminateWorker();
        throw error;
      }
    },
    deactivate: async () => {
      if (terminated) return; // A failed activate/execute already reclaimed it.
      try {
        await withTimeout(ready, options.timeoutMs, entry.id);
        await call('deactivate');
      } finally {
        await terminateWorker();
      }
    },
    execute: async (request) => {
      try {
        await withTimeout(ready, options.timeoutMs, entry.id);
        return await call('execute', request);
      } catch (error) {
        await terminateWorker();
        throw error;
      }
    },
    callService: async (name, method, args) => {
      try {
        await withTimeout(ready, options.timeoutMs, entry.id);
        return await call('service-call', { name, method, args });
      } catch (error) {
        await terminateWorker();
        throw error;
      }
    },
  };
}

function timeoutFor(
  kind: 'activate' | 'deactivate' | 'execute' | 'service-call',
  payload: unknown,
  activationTimeoutMs: number | undefined,
): number | undefined {
  if (kind === 'execute') {
    const budget = (payload as { readonly budget?: { readonly maxWallMs?: unknown } } | undefined)
      ?.budget?.maxWallMs;
    if (Number.isSafeInteger(budget) && (budget as number) >= 1) return (budget as number) + 30_000;
    return activationTimeoutMs;
  }
  if (kind === 'service-call') return Math.max(activationTimeoutMs ?? 10_000, 30_000);
  return activationTimeoutMs;
}

export interface DynamicWasmLoaderOptions {
  readonly roots: readonly PluginRootConfig[];
  readonly scope: PluginScope;
  readonly defaultTrustLevel?: 't0' | 't1' | 't2' | 't3' | 't4' | 't5';
  readonly trustOverrides?: ReadonlyMap<string, 't0' | 't1' | 't2' | 't3' | 't4' | 't5'>;
  readonly maxWasmBytes?: number;
  readonly maxMemoryBytes?: number;
  readonly activationTimeoutMs?: number;
  /** Wasmtime Component Model runner used for manifest `component` entrypoints. */
  readonly componentRunner?: string;
  readonly capabilities?: ReadonlySet<string>;
  readonly imports?: WasmHostImports;
  /** Run the WASM instance in a disposable Worker with hard termination. */
  readonly isolate?: boolean;
  readonly onCapability?: (capability: string, payload: unknown) => void;
  readonly onCapabilityRequest?: (
    capability: string,
    payload: unknown,
  ) => unknown | Promise<unknown>;
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
    if (entry.manifest.entrypoints.component !== undefined) {
      if (options.componentRunner === undefined) return undefined;
      return createDynamicComponentThunk(entry, options, rootsById);
    }
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

function createDynamicComponentThunk(
  entry: PluginCatalogEntry,
  options: DynamicWasmLoaderOptions,
  rootsById: ReadonlyMap<string, string>,
): (() => Promise<PluginModule>) | undefined {
  const root = rootsById.get(entry.rootId);
  const relativeEntrypoint = entry.manifest.entrypoints.component;
  if (
    !root ||
    !relativeEntrypoint ||
    !isSafeRelative(entry.path) ||
    !isSafeRelative(relativeEntrypoint)
  ) {
    report(
      options,
      new DynamicEsmLoaderError(`plugin '${entry.id}' component path is invalid`, 'path'),
    );
    return undefined;
  }
  let packageDir: string;
  let componentPath: string;
  try {
    packageDir = realpathSync(resolve(root, entry.path));
    componentPath = resolve(packageDir, relativeEntrypoint);
    if (!isWithin(root, packageDir) || !lstatSync(packageDir).isDirectory())
      throw new Error('package path');
    const componentReal = realpathSync(componentPath);
    if (!isWithin(packageDir, componentReal) || !lstatSync(componentReal).isFile())
      throw new Error('component path');
    if (statSync(componentReal).size > (options.maxWasmBytes ?? 16 * 1024 * 1024))
      throw new Error('component size');
    if (computePackageDigest(packageDir, entry.manifest) !== entry.sha256.toLowerCase())
      throw new Error('digest mismatch');
  } catch {
    report(
      options,
      new DynamicEsmLoaderError(`plugin '${entry.id}' component package is invalid`, 'integrity'),
    );
    return undefined;
  }
  return async () => {
    const controller = createComponentRunnerController(
      options.componentRunner!,
      componentPath,
      entry.id,
      options.activationTimeoutMs,
      options.onCapabilityRequest,
      options.capabilities,
      options.maxMemoryBytes,
    );
    return {
      activate: () => controller.activate(),
      deactivate: () => controller.deactivate(),
    } satisfies PluginModule;
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
       if (capabilities.includes('runtime.random')) logicpilot.random_u32 = () => {
         const value = Math.floor(Math.random() * 0x100000000);
         // The ABI is synchronous, so the value is produced locally; still
         // report every invocation to the host broker for audit/quota policy.
         parentPort.postMessage({ kind: 'capability', capability: 'runtime.random', payload: { value } });
         return value;
       };
      return { logicpilot };
    }
    (async () => {
      try {
        const bytes = readFileSync(workerData.path);
        const result = await WebAssembly.instantiate(bytes, importsFor(workerData.capabilities));
        instance = result.instance;
        const memory = instance.exports.memory;
        const checkMemory = () => {
          const size = memory && memory.buffer ? memory.buffer.byteLength : 0;
          if (workerData.maxMemoryBytes && size > workerData.maxMemoryBytes)
            throw new Error('memory-limit');
        };
        checkMemory();
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
        // WASM can grow linear memory after instantiation. Re-check after
        // every host-visible lifecycle operation and fail closed if it grows
        // beyond the configured quota.
        const memory = instance.exports.memory;
        if (workerData.maxMemoryBytes && memory?.buffer?.byteLength > workerData.maxMemoryBytes)
          throw new Error('memory-limit');
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
