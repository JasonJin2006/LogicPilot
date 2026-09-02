// Catalog discovery gate tests (Phase 2B-1, ADR-0071): payload validation,
// Phase 2B-1 loader policy, the activation-safe projection (missing deps,
// cycles, version conflicts, unloadable entrypoints) and the remote source
// with a stubbed bridge.
import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@logicpilot/contracts';
import {
  RemoteCatalogDiscoverySource,
  defaultCatalogEntryLoader,
  parsePluginCatalogPayload,
  projectCatalogEntries,
  type CatalogFetch,
  type PluginCatalog,
  type PluginCatalogEntry,
} from '../src/index.js';

const TEST_SHA = 'a'.repeat(64);

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: `logicpilot.catalog-${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
    integrity: { sha256: TEST_SHA },
    ...overrides,
  };
}

function entry(overrides: Partial<PluginCatalogEntry> = {}): PluginCatalogEntry {
  const m = manifest({ id: `logicpilot.catalog-${Math.random().toString(36).slice(2)}` });
  return {
    id: m.id,
    scope: 'workspace',
    rootId: 'workspace:1',
    path: m.id,
    sha256: TEST_SHA,
    manifest: m,
    ...overrides,
  };
}

function catalogFixture(overrides: Partial<PluginCatalog> = {}): PluginCatalog {
  return {
    schema: 'logicpilot.plugin-catalog/v1',
    contractVersion: 1,
    roots: [
      { id: 'system:1', scope: 'system' },
      { id: 'workspace:1', scope: 'workspace' },
    ],
    entries: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('plugin catalog payload validation', () => {
  it('accepts a well-formed catalog', () => {
    const payload = catalogFixture({ entries: [entry()] });
    const parsed = parsePluginCatalogPayload(payload);
    expect(parsed.ok).toBe(true);
  });

  it('rejects unknown schema markers and bad manifests', () => {
    expect(parsePluginCatalogPayload({ ...catalogFixture(), schema: 'nope' }).ok).toBe(false);
    const bad = catalogFixture({
      entries: [{ ...entry(), manifest: { ...manifest(), schema: 'wrong' } }],
    });
    const parsed = parsePluginCatalogPayload(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join('; ')).toContain('/entries/0/manifest');
  });

  it('rejects inconsistent identities across the envelope', () => {
    const mismatch = catalogFixture({
      entries: [{ ...entry(), id: 'logicpilot.other' }],
    });
    expect(parsePluginCatalogPayload(mismatch).ok).toBe(false);

    const unknownRoot = catalogFixture({
      entries: [{ ...entry(), rootId: 'workspace:9' }],
    });
    expect(parsePluginCatalogPayload(unknownRoot).ok).toBe(false);

    const scopeRootMismatch = catalogFixture({
      entries: [{ ...entry(), scope: 'system', rootId: 'workspace:1' }],
    });
    const parsed = parsePluginCatalogPayload(scopeRootMismatch);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0] ?? '').toContain('scope');

    const traversal = catalogFixture({
      entries: [{ ...entry(), path: '../escape' }],
    });
    expect(parsePluginCatalogPayload(traversal).ok).toBe(false);
  });

  it('accepts diagnostics without optional path/rootId fields', () => {
    const payload = catalogFixture({
      diagnostics: [
        {
          severity: 'error',
          kind: 'schema',
          message: 'package x is broken',
          pluginId: 'logicpilot.broken',
          scope: 'workspace',
        },
      ],
    });
    expect(parsePluginCatalogPayload(payload).ok).toBe(true);
  });

  it('rejects non-canonical catalog paths (drive prefix, dot/empty segments)', () => {
    for (const path of ['C:/private', './dot', 'a/./b', 'a//b', 'a/b/', '../up', 'a\\b', '/abs']) {
      const payload = catalogFixture({ entries: [{ ...entry(), path }] });
      expect(parsePluginCatalogPayload(payload).ok, `path '${path}' must be rejected`).toBe(false);
    }
  });

  it('accepts ordinary dotted names as catalog paths', () => {
    const payload = catalogFixture({ entries: [{ ...entry(), path: 'assets.v1/knowledge' }] });
    expect(parsePluginCatalogPayload(payload).ok).toBe(true);
  });

  it('rejects non-hex digests and invalid scopes through the frozen schema', () => {
    const nonHex = catalogFixture({
      entries: [{ ...entry(), sha256: 'g'.repeat(64) }],
    });
    expect(parsePluginCatalogPayload(nonHex).ok).toBe(false);
    const badScope = catalogFixture({
      entries: [{ ...entry(), scope: 'root' as never }],
    });
    expect(parsePluginCatalogPayload(badScope).ok).toBe(false);
  });
});

describe('Phase 2B-1 loader policy', () => {
  it('loads data-only and manifest-only packages as no-op modules', () => {
    const manifestOnly = entry({ manifest: manifest({ entrypoints: {} }) });
    const dataOnly = entry({
      manifest: manifest({ entrypoints: { data: './assets' } }),
    });
    expect(defaultCatalogEntryLoader(manifestOnly)).toBeDefined();
    expect(defaultCatalogEntryLoader(dataOnly)).toBeDefined();
  });

  it('refuses web/node/wasm/native entrypoints (Phase 2B-3)', () => {
    for (const path of ['web', 'node', 'wasm', 'native']) {
      const candidate = entry({
        manifest: manifest({ entrypoints: { [path]: './entry.js' } }),
      });
      expect(defaultCatalogEntryLoader(candidate)).toBeUndefined();
    }
  });
});

describe('projection', () => {
  const loadable = () => true;
  const unloadable = () => false;

  it('excludes unloadable entries and keeps the rest', () => {
    const good = entry();
    const bad = entry({
      manifest: manifest({ entrypoints: { web: './activate.ts' } }),
    });
    const policy = (candidate: PluginCatalogEntry) =>
      defaultCatalogEntryLoader(candidate) !== undefined;
    const projection = projectCatalogEntries([good, bad], policy);
    expect(projection.entries.map((entry) => entry.id)).toEqual([good.id]);
    expect(projection.excluded).toHaveLength(1);
    expect(projection.diagnostics[0]?.kind).toBe('loadable');
  });

  it('cascades exclusion to dependents of missing dependencies', () => {
    const base = entry();
    const app = entry({
      manifest: manifest({ requires: [{ id: base.id }] }),
    });
    const orphan = entry({
      manifest: manifest({ requires: [{ id: 'logicpilot.missing' }] }),
    });
    const consumer = entry({
      manifest: manifest({ requires: [{ id: orphan.id }], version: '1.1.0' }),
    });
    const projection = projectCatalogEntries([base, app, orphan, consumer], unloadable);
    // unloadable() removes everything; use a loader excluding only the orphan.
    const withUnloadable = projectCatalogEntries(
      [base, app, orphan, consumer],
      (candidate) => candidate.id !== orphan.id,
    );
    const ids = withUnloadable.entries.map((candidate) => candidate.id);
    expect(ids).toContain(base.id);
    expect(ids).toContain(app.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).not.toContain(consumer.id);
    expect(projection.entries).toHaveLength(0);
  });

  it('excludes dependent whose version range is unsatisfied', () => {
    const lib = entry({ manifest: manifest({ version: '1.0.0' }) });
    const consumer = entry({
      manifest: manifest({ requires: [{ id: lib.id, range: '^2.0.0' }] }),
    });
    const projection = projectCatalogEntries([lib, consumer], loadable);
    expect(projection.entries.map((candidate) => candidate.id)).toEqual([lib.id]);
    expect(projection.excluded[0]?.entry.id).toBe(consumer.id);
  });

  it('drops cycle members and keeps independent plugins', () => {
    const idA = 'logicpilot.cycle-a';
    const idB = 'logicpilot.cycle-b';
    const entryA = entry({
      id: idA,
      manifest: manifest({ id: idA, requires: [{ id: idB }] }),
    });
    const entryB = entry({
      id: idB,
      manifest: manifest({ id: idB, requires: [{ id: idA }] }),
    });
    const independent = entry();
    const projection = projectCatalogEntries([entryA, entryB, independent], loadable);
    const ids = projection.entries.map((candidate) => candidate.id);
    expect(ids).toContain(independent.id);
    expect(ids).not.toContain(idA);
    expect(ids).not.toContain(idB);
    expect(projection.diagnostics.some((diagnostic) => diagnostic.kind === 'dependency')).toBe(
      true,
    );
  });

  it('keeps only the first occurrence of an in-scope duplicate id', () => {
    const first = entry({ path: 'aaa' });
    const second = entry({ id: first.id, path: 'bbb', manifest: manifest({ id: first.id }) });
    const projection = projectCatalogEntries([first, second], loadable);
    expect(projection.entries.map((candidate) => candidate.path)).toEqual(['aaa']);
    expect(projection.excluded[0]?.reason).toContain('duplicate');
  });

  it('keeps optional-dependency-only entries when the optional dep is missing', () => {
    const app = entry({
      manifest: manifest({ requires: [{ id: 'logicpilot.optional', optional: true }] }),
    });
    const projection = projectCatalogEntries([app], loadable);
    expect(projection.entries.map((candidate) => candidate.id)).toEqual([app.id]);
  });

  it('converges on long unloadable chains (fixpoint, not a fixed pass limit)', () => {
    const count = 12;
    const ids = Array.from({ length: count }, (_, index) => `logicpilot.chain-${index}`);
    const head = entry({
      id: ids[0] as string,
      manifest: manifest({
        id: ids[0] as string,
        entrypoints: { web: './activate.ts' },
      }),
    });
    const chain: PluginCatalogEntry[] = [head];
    for (let index = 1; index < count; index += 1) {
      chain.push(
        entry({
          id: ids[index] as string,
          manifest: manifest({
            id: ids[index] as string,
            requires: [{ id: ids[index - 1] as string }],
          }),
        }),
      );
    }
    const independent = entry();
    const policy = (candidate: PluginCatalogEntry) =>
      defaultCatalogEntryLoader(candidate) !== undefined;
    const projection = projectCatalogEntries([...chain, independent], policy);
    // Every chain member is excluded (the head is unloadable, dependents
    // cascade); the independent plugin survives. No entry may reference a
    // dependency that is not in the projected set.
    expect(projection.entries.map((candidate) => candidate.id)).toEqual([independent.id]);
    expect(projection.excluded).toHaveLength(count);
    const projectedIds = new Set(projection.entries.map((candidate) => candidate.id));
    for (const candidate of projection.entries) {
      for (const dependency of candidate.manifest.requires) {
        if (!dependency.optional) {
          expect(projectedIds.has(dependency.id)).toBe(true);
        }
      }
    }
  });
});

describe('RemoteCatalogDiscoverySource', () => {
  function stubFetch(
    response: () => { ok: boolean; status: number; json: () => unknown },
    capture?: { url?: string; headers?: Readonly<Record<string, string>> },
  ): CatalogFetch {
    return async (url, init) => {
      if (capture) {
        capture.url = url;
        capture.headers = init?.headers;
      }
      const body = response();
      return {
        ok: body.ok,
        status: body.status,
        json: async () => body.json(),
      };
    };
  }

  it('discovers only its scope and injects the scanner digest into the manifest', async () => {
    const dataOnly = entry({
      manifest: manifest({ id: 'logicpilot.demo.data', entrypoints: {} }),
      id: 'logicpilot.demo.data',
    });
    const systemOnly = entry({
      manifest: manifest({ id: 'logicpilot.demo.system', entrypoints: {} }),
      id: 'logicpilot.demo.system',
      scope: 'system',
      rootId: 'system:1',
    });
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'workspace',
      fetch: stubFetch(() => ({
        ok: true,
        status: 200,
        json: () => catalogFixture({ entries: [dataOnly, systemOnly] }),
      })),
    });
    const discovered = await source.discover();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.manifest.id).toBe('logicpilot.demo.data');
    expect(discovered[0]?.manifest.integrity?.sha256).toBe(TEST_SHA);
    expect(source.lastError()).toBeUndefined();
  });

  it('skips web-entrypoint plugins under the default policy and reports them', async () => {
    const webOnly = entry({
      manifest: manifest({ id: 'logicpilot.demo.web', entrypoints: { web: './activate.ts' } }),
      id: 'logicpilot.demo.web',
    });
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'workspace',
      fetch: stubFetch(() => ({
        ok: true,
        status: 200,
        json: () => catalogFixture({ entries: [webOnly] }),
      })),
    });
    expect(await source.discover()).toEqual([]);
    expect(source.excludedEntries().map((excluded) => excluded.entry.id)).toEqual([webOnly.id]);
  });

  it('honors a shell-provided loader for executable entrypoints', async () => {
    const webOnly = entry({
      manifest: manifest({ id: 'logicpilot.demo.web', entrypoints: { web: './activate.ts' } }),
      id: 'logicpilot.demo.web',
    });
    let activated = 0;
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'workspace',
      fetch: stubFetch(() => ({
        ok: true,
        status: 200,
        json: () => catalogFixture({ entries: [webOnly] }),
      })),
      resolveLoader: () => ({
        activate: () => {
          activated += 1;
        },
      }),
    });
    const discovered = await source.discover();
    expect(discovered).toHaveLength(1);
    await discovered[0]?.load().activate();
    expect(activated).toBe(1);
  });

  it('travels through bridge failures without throwing', async () => {
    let errorHookCalls = 0;
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'system',
      fetch: stubFetch(() => ({ ok: false, status: 500, json: () => null })),
      onError: () => {
        errorHookCalls += 1;
      },
    });
    expect(await source.discover()).toEqual([]);
    expect(source.lastError()).toBeInstanceOf(Error);
    expect(errorHookCalls).toBe(1);
  });

  it('rejects malformed bridge payloads as transport errors', async () => {
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'workspace',
      fetch: stubFetch(() => ({ ok: true, status: 200, json: () => ({ never: 1 }) })),
    });
    expect(await source.discover()).toEqual([]);
    expect(String(source.lastError())).toContain('invalid plugin catalog payload');
  });

  it('passes the scope query and configured headers to the bridge', async () => {
    const captured: { url?: string; headers?: Readonly<Record<string, string>> } = {};
    const source = new RemoteCatalogDiscoverySource({
      url: 'http://bridge.test/catalog',
      scope: 'user',
      headers: { 'x-logicpilot-session': 'token-1' },
      fetch: stubFetch(() => ({ ok: true, status: 200, json: () => catalogFixture() }), captured),
    });
    await source.discover();
    expect(captured.url).toBe('http://bridge.test/catalog?scope=user');
    expect(captured.headers?.['x-logicpilot-session']).toBe('token-1');
  });
});
