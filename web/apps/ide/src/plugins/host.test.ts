// Phase 2 gate coverage: builtin manifests validate against the frozen
// contract, the host activates them deterministically, and a ZERO-paradigm
// host boots cleanly (the shell must work with no plugins at all).

import { afterEach, describe, expect, it } from 'vitest';
import { parseBuiltinManifest, startIdePluginHost, stopIdePluginHost } from './host';
import desManifestJson from './builtin/des/plugin.json';
import sysmlManifestJson from './builtin/sysml/plugin.json';
import { DOCUMENT_CONTRIBUTIONS } from '../workbench/documentTypes';
import { DIAGNOSTIC_PROVIDERS } from '../workbench/diagnostics';
import { OUTLINE_CONTRIBUTIONS } from '../workbench/outline';
import { PALETTE_CONTRIBUTIONS } from '../workbench/palette';
import { contributedProblemStores } from '../workbench/problems';
import { PANELS } from '../layout/panels';

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
