// Phase 2 gate coverage: builtin manifests validate against the frozen
// contract, the host activates them deterministically, and a ZERO-paradigm
// host boots cleanly (the shell must work with no plugins at all). Phase
// 2B-1 (ADR-0071): remote catalog discovery through the local bridge.

import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogFetch, PluginCatalog } from '@logicpilot/plugin-host';
import { parseBuiltinManifest, startIdePluginHost, stopIdePluginHost } from './host';
import desManifestJson from './builtin/des/plugin.json';
import sysmlManifestJson from './builtin/sysml/plugin.json';
import { DOCUMENT_CONTRIBUTIONS } from '../workbench/documentTypes';
import { DIAGNOSTIC_PROVIDERS } from '../workbench/diagnostics';
import { OUTLINE_CONTRIBUTIONS } from '../workbench/outline';
import { PALETTE_CONTRIBUTIONS } from '../workbench/palette';
import { contributedProblemStores } from '../workbench/problems';
import { PANELS } from '../layout/panels';
import { PLUGIN_REGISTRY } from './registry';
import { compilePluginContext } from '../ai/contextCompiler';

afterEach(async () => {
  await stopIdePluginHost();
});

describe('builtin plugin manifests', () => {
  it('des manifest validates against the frozen PluginManifest v2 contract', () => {
    const manifest = parseBuiltinManifest(desManifestJson);
    expect(manifest.id).toBe('logicpilot.des');
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.entrypoints.web).toBe('./activate.ts');
  });

  it('sysml manifest validates against the frozen PluginManifest v2 contract', () => {
    const manifest = parseBuiltinManifest(sysmlManifestJson);
    expect(manifest.id).toBe('logicpilot.sysml');
    expect(manifest.trust.minLevel).toBe('t0');
  });

  it('rejects a drifted manifest loudly', () => {
    // A wrong schema discriminator breaks the frozen contract (apiVersion
    // support-set gating happens later, at host discovery).
    const broken = { ...(desManifestJson as object), schema: 'logicpilot.plugin-manifest/v1' };
    expect(() => parseBuiltinManifest(broken)).toThrow(/builtin plugin manifest rejected/);
  });
});

describe('IDE plugin host', () => {
  it('activates both builtin plugins in dependency order', async () => {
    const host = await startIdePluginHost();
    expect([...host.ids()].sort()).toEqual(['logicpilot.des', 'logicpilot.sysml']);
    expect(host.phaseValue).toBe('active');
    expect(PLUGIN_REGISTRY.snapshot().contributions.map((set) => set.pluginId)).toEqual([
      'logicpilot.des',
      'logicpilot.sysml',
    ]);
    const context = compilePluginContext(PLUGIN_REGISTRY.snapshot(), {
      documentType: 'dsl',
      paradigm: 'logicpilot-process',
    });
    expect(context.knowledge).toContain('logicpilot.des.queueing.core');
    expect(context.instructions).toContain('logicpilot.des.instruction.safety');
    expect(context.diagnosticDefinitions).toContain('LP2004');
  });

  it('boots a ZERO-paradigm host (Phase 2 gate: empty discovery table)', async () => {
    await stopIdePluginHost();
    const host = await startIdePluginHost({ builtins: [] });
    expect(host.ids()).toEqual([]);
    expect(host.phaseValue).toBe('active');
    expect(DOCUMENT_CONTRIBUTIONS.list()).toEqual([]);
    expect(DIAGNOSTIC_PROVIDERS.forDocumentTypes('dsl', 'sysml')).toEqual([]);
    expect(OUTLINE_CONTRIBUTIONS.list()).toEqual([]);
    expect(PALETTE_CONTRIBUTIONS.allItems()).toEqual([]);
    expect(contributedProblemStores()).toEqual([]);
    expect(PANELS.sysml).toBeUndefined();
    expect(PLUGIN_REGISTRY.snapshot().contributions).toEqual([]);
  });

  it('writes a contracts-shaped lockfile of the discovered set', async () => {
    const host = await startIdePluginHost();
    const lockfile = host.toLockfile();
    expect(lockfile.schema).toBe('logicpilot.plugin-lock/v1');
    expect(lockfile.plugins.map((entry) => entry.id)).toEqual([
      'logicpilot.des',
      'logicpilot.sysml',
    ]);
  });
});

describe('remote catalog discovery (Phase 2B-1)', () => {
  const SHA = 'a'.repeat(64);

  function catalogManifest(
    id: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id,
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: {},
      permissions: [],
      trust: { minLevel: 't0' },
      ...overrides,
    };
  }

  function catalogFixture(): PluginCatalog {
    return {
      schema: 'logicpilot.plugin-catalog/v1',
      contractVersion: 1,
      roots: [
        { id: 'system:1', scope: 'system' },
        { id: 'workspace:1', scope: 'workspace' },
      ],
      entries: [
        {
          id: 'logicpilot.demo.data',
          scope: 'workspace',
          rootId: 'workspace:1',
          path: 'demo-data',
          sha256: SHA,
          manifest: catalogManifest('logicpilot.demo.data', {
            entrypoints: { data: './assets' },
          }) as never,
        },
        {
          id: 'logicpilot.demo.web',
          scope: 'workspace',
          rootId: 'workspace:1',
          path: 'demo-web',
          sha256: SHA,
          manifest: catalogManifest('logicpilot.demo.web', {
            entrypoints: { web: './activate.ts' },
          }) as never,
        },
        {
          id: 'logicpilot.demo.orphan',
          scope: 'workspace',
          rootId: 'workspace:1',
          path: 'demo-orphan',
          sha256: SHA,
          manifest: catalogManifest('logicpilot.demo.orphan', {
            requires: [{ id: 'logicpilot.missing' }],
          }) as never,
        },
        {
          id: 'logicpilot.demo.system',
          scope: 'system',
          rootId: 'system:1',
          path: 'demo-system',
          sha256: SHA,
          manifest: catalogManifest('logicpilot.demo.system') as never,
        },
      ],
      diagnostics: [
        {
          severity: 'error',
          kind: 'schema',
          message: 'package demo-broken: plugin.json is not a valid manifest',
          pluginId: 'logicpilot.demo.broken',
          scope: 'workspace',
        },
      ],
    };
  }

  function stubCatalogFetch(): CatalogFetch {
    const catalog = catalogFixture();
    return async (url) => {
      const scope = new URL(url, 'http://catalog.test').searchParams.get('scope') ?? undefined;
      const filtered =
        scope === undefined
          ? catalog
          : {
              ...catalog,
              roots: catalog.roots.filter((root) => root.scope === scope),
              entries: catalog.entries.filter((entry) => entry.scope === scope),
              diagnostics: catalog.diagnostics.filter(
                (diagnostic) => diagnostic.scope === undefined || diagnostic.scope === scope,
              ),
            };
      return { ok: true, status: 200, json: async () => filtered };
    };
  }

  it('activates loadable catalog plugins per scope and excludes the rest', async () => {
    await stopIdePluginHost();
    const host = await startIdePluginHost({ catalog: { fetch: stubCatalogFetch() } });
    const ids = [...host.ids()].sort();
    // Builtins + the loadable data-only workspace plugin; the system plugin
    // is data-only too, so it also activates. Executable entrypoints and
    // broken dependencies stay out of the host.
    expect(ids).toContain('logicpilot.demo.data');
    expect(ids).toContain('logicpilot.demo.system');
    expect(ids).not.toContain('logicpilot.demo.web');
    expect(ids).not.toContain('logicpilot.demo.orphan');
    expect(host.phaseValue).toBe('active');
  });

  it('audits catalog denials and errors without breaking the host', async () => {
    await stopIdePluginHost();
    const host = await startIdePluginHost({ catalog: { fetch: stubCatalogFetch() } });
    const audit = host.auditLog.list();
    expect(
      audit.some((entry) => entry.action === 'error' && entry.detail?.includes('schema')),
    ).toBe(true);
    expect(
      audit.some(
        (entry) =>
          entry.action === 'deny' &&
          entry.pluginId === 'logicpilot.demo.web' &&
          (entry.detail ?? '').includes('not loadable'),
      ),
    ).toBe(true);
    expect(
      audit.some(
        (entry) =>
          entry.action === 'deny' &&
          entry.pluginId === 'logicpilot.demo.orphan' &&
          (entry.detail ?? '').includes('missing'),
      ),
    ).toBe(true);
  });

  it('degrades to the bundled set when the bridge is unreachable', async () => {
    await stopIdePluginHost();
    const host = await startIdePluginHost({
      catalog: { fetch: async () => ({ ok: false, status: 503, json: async () => null }) },
    });
    expect([...host.ids()].sort()).toEqual(['logicpilot.des', 'logicpilot.sysml']);
    expect(host.auditLog.list().some((entry) => entry.detail?.includes('bridge unavailable'))).toBe(
      true,
    );
  });
});
