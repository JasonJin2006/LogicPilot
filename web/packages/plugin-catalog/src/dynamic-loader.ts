// Node-side dynamic ESM loader (Phase 2B-3 first slice). The browser never
// receives a filesystem path or imports a package directly; it consumes the
// already activated contributions through the host bridge.

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginCatalogEntry, PluginModule, PluginScope } from '@logicpilot/plugin-host';
import type { PluginRootConfig } from './catalog.js';
import { computePackageDigest } from './catalog.js';

export interface DynamicEsmLoaderOptions {
  readonly roots: readonly PluginRootConfig[];
  readonly scope: PluginScope;
  /** `node` is the only executable runtime enabled in this first slice. */
  readonly runtime?: 'node';
  readonly defaultTrustLevel?: 't0' | 't1' | 't2' | 't3' | 't4' | 't5';
  readonly trustOverrides?: ReadonlyMap<string, 't0' | 't1' | 't2' | 't3' | 't4' | 't5'>;
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
    const minimum = entry.manifest.trust.minLevel;
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
    const url = pathToFileURL(modulePath).href;
    return async () => {
      try {
        // A URL fragment busts Node's ESM module cache on upgrade without
        // making Vite treat the absolute Windows path as a query resource.
        const namespace = (await import(
          /* @vite-ignore */ `${url}#lp=${encodeURIComponent(entry.sha256)}`
        )) as Record<string, unknown>;
        const candidate = namespace.default ?? namespace;
        if (!isPluginModule(candidate)) throw new Error('missing activate export');
        return candidate;
      } catch {
        throw new DynamicEsmLoaderError(`plugin '${entry.id}' module failed to load`, 'module');
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
