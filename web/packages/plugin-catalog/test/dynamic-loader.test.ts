import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginCatalogEntry, PluginManifest } from '@logicpilot/contracts';
import { computePackageDigest, createDynamicEsmLoader } from '../src/index.js';

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
    expect(loader(drifted)).toBeUndefined();
    expect(denied).toContain('integrity');
  });
});
