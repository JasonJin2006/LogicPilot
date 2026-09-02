// Scanner gate tests (Phase 2B-1, ADR-0071): root/package layout, strict
// manifest validation, canonical payload digest, corrupt-package isolation,
// in-scope duplicates, symlink/path containment and dependency diagnostics.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanPluginCatalog } from '../src/index.js';

let fixtureSeq = 0;
const cleanups: string[] = [];

function tempRoot(): string {
  fixtureSeq += 1;
  const dir = mkdtempSync(join(tmpdir(), `lp-plugin-catalog-${process.pid}-${fixtureSeq}-`));
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writePlugin(dir: string, overrides: Record<string, unknown> = {}): void {
  const manifest: Record<string, unknown> = {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: `logicpilot.fixture-${fixtureSeq}-${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
    ...overrides,
  };
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
}

function writeAsset(dir: string, rel: string, content: string | Buffer): void {
  const target = join(dir, rel);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

/** Mirrors the canonical framing (ADR-0071 §4) for cross-checking. */
function expectedDigest(files: readonly { rel: string; content: Buffer }[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const relBytes = Buffer.from(file.rel, 'utf8');
    hash.update(String(relBytes.length));
    hash.update(':');
    hash.update(relBytes);
    hash.update(String(file.content.length));
    hash.update(':');
    hash.update(file.content);
  }
  return hash.digest('hex');
}

function declares(
  manifest: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { schema: 'logicpilot.plugin-manifest/v2', contractVersion: 1, ...manifest, ...overrides };
}

describe('plugin catalog scanner', () => {
  it('lists a manifest-only package with the canonical payload digest', async () => {
    const root = tempRoot();
    const pkg = join(root, 'knowledge-pack');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.knowledge', entrypoints: { data: './assets' } });
    writeAsset(pkg, 'assets/a.txt', 'hello');
    writeAsset(pkg, 'assets/sub/b.bin', Buffer.from([0, 1, 2, 255]));
    writeAsset(pkg, 'README.md', 'docs');

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries).toHaveLength(1);
    const entry = catalog.entries[0];
    expect(entry?.id).toBe('logicpilot.knowledge');
    expect(entry?.scope).toBe('system');
    expect(entry?.rootId).toBe('system:1');
    expect(entry?.path).toBe('knowledge-pack');
    expect(entry?.sha256).toBe(
      expectedDigest([
        { rel: 'README.md', content: Buffer.from('docs') },
        { rel: 'assets/a.txt', content: Buffer.from('hello') },
        { rel: 'assets/sub/b.bin', content: Buffer.from([0, 1, 2, 255]) },
      ]),
    );
    expect(catalog.diagnostics).toEqual([]);
  });

  it('accepts a declared integrity that matches the computed digest', async () => {
    const root = tempRoot();
    const pkg = join(root, 'signed');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.signed' });
    writeAsset(pkg, 'asset.txt', 'payload');
    const digest = expectedDigest([{ rel: 'asset.txt', content: Buffer.from('payload') }]);
    writePlugin(pkg, declares({ id: 'logicpilot.signed' }, { integrity: { sha256: digest } }));

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'user', path: root }] });
    expect(catalog.entries[0]?.sha256).toBe(digest);
    expect(catalog.diagnostics).toEqual([]);
  });

  it('excludes hash-drift packages but keeps independent ones', async () => {
    const root = tempRoot();
    const drifted = join(root, 'drifted');
    mkdirSync(drifted);
    writePlugin(drifted, { id: 'logicpilot.drifted', integrity: { sha256: 'b'.repeat(64) } });
    writeAsset(drifted, 'payload.txt', 'content');
    const healthy = join(root, 'healthy');
    mkdirSync(healthy);
    writePlugin(healthy, { id: 'logicpilot.healthy' });

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'workspace', path: root }] });
    expect(catalog.entries.map((entry) => entry.id)).toEqual(['logicpilot.healthy']);
    const diagnostic = catalog.diagnostics.find((candidate) => candidate.kind === 'hash-drift');
    expect(diagnostic?.severity).toBe('error');
    expect(diagnostic?.pluginId).toBe('logicpilot.drifted');
  });

  it('isolates broken JSON and invalid manifests from valid packages', async () => {
    const root = tempRoot();
    const brokenJson = join(root, 'broken-json');
    mkdirSync(brokenJson);
    writeFileSync(join(brokenJson, 'plugin.json'), '{ not json');
    const wrongSchema = join(root, 'wrong-schema');
    mkdirSync(wrongSchema);
    writePlugin(wrongSchema, { schema: 'logicpilot.plugin-manifest/v1' });
    const valid = join(root, 'valid');
    mkdirSync(valid);
    writePlugin(valid, { id: 'logicpilot.valid' });

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries.map((entry) => entry.id)).toEqual(['logicpilot.valid']);
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.kind).sort()).toEqual([
      'json',
      'schema',
    ]);
  });

  it('warns on an unsupported apiVersion without excluding the package', async () => {
    const root = tempRoot();
    const pkg = join(root, 'future');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.future', apiVersion: 2 });
    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries).toHaveLength(1);
    const diagnostic = catalog.diagnostics.find((candidate) => candidate.kind === 'api-version');
    expect(diagnostic?.severity).toBe('warning');
    expect(diagnostic?.pluginId).toBe('logicpilot.future');
  });

  it('keeps only the first occurrence of a duplicate id inside one root', async () => {
    const root = tempRoot();
    const first = join(root, 'a-first');
    mkdirSync(first);
    writePlugin(first, { id: 'logicpilot.dup' });
    const second = join(root, 'b-second');
    mkdirSync(second);
    writePlugin(second, { id: 'logicpilot.dup' });

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'workspace', path: root }] });
    expect(catalog.entries.map((entry) => entry.path)).toEqual(['a-first']);
    const diagnostic = catalog.diagnostics.find((candidate) => candidate.kind === 'duplicate-id');
    expect(diagnostic?.path).toBe('b-second');
  });

  it('lets the earlier root win an in-scope duplicate', async () => {
    const firstRoot = tempRoot();
    const secondRoot = tempRoot();
    for (const root of [firstRoot, secondRoot]) {
      const pkg = join(root, 'pkg');
      mkdirSync(pkg);
      writePlugin(pkg, { id: 'logicpilot.dup-scope' });
    }
    const catalog = await scanPluginCatalog({
      roots: [
        { scope: 'user', path: firstRoot },
        { scope: 'user', path: secondRoot },
      ],
    });
    expect(catalog.entries.map((entry) => entry.rootId)).toEqual(['user:1']);
    expect(catalog.diagnostics.some((candidate) => candidate.kind === 'duplicate-id')).toBe(true);
  });

  it('keeps the same id in different scopes (host applies the overlay)', async () => {
    const systemRoot = tempRoot();
    const workspaceRoot = tempRoot();
    for (const [root, scope] of [
      [systemRoot, 'system'],
      [workspaceRoot, 'workspace'],
    ] as const) {
      const pkg = join(root, 'pkg');
      mkdirSync(pkg);
      writePlugin(pkg, {
        id: 'logicpilot.overlaid',
        version: scope === 'system' ? '1.0.0' : '2.0.0',
      });
    }
    const catalog = await scanPluginCatalog({
      roots: [
        { scope: 'system', path: systemRoot },
        { scope: 'workspace', path: workspaceRoot },
      ],
    });
    expect(catalog.entries.map((entry) => entry.scope).sort()).toEqual(['system', 'workspace']);
    expect(catalog.diagnostics).toEqual([]);
  });

  it('records a missing non-optional dependency diagnostic without excluding entries', async () => {
    const root = tempRoot();
    const orphan = join(root, 'orphan');
    mkdirSync(orphan);
    writePlugin(orphan, { id: 'logicpilot.orphan', requires: [{ id: 'logicpilot.missing' }] });
    const valid = join(root, 'valid');
    mkdirSync(valid);
    writePlugin(valid, { id: 'logicpilot.valid' });

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'workspace', path: root }] });
    expect(catalog.entries).toHaveLength(2);
    const diagnostic = catalog.diagnostics.find(
      (candidate) => candidate.kind === 'dependency' && candidate.message.includes('missing'),
    );
    expect(diagnostic?.pluginId).toBe('logicpilot.orphan');
  });

  it('records a dependency-cycle diagnostic without excluding the cycled entries', async () => {
    const root = tempRoot();
    const cyclicA = join(root, 'cycle-a');
    mkdirSync(cyclicA);
    writePlugin(cyclicA, { id: 'logicpilot.cycle-a', requires: [{ id: 'logicpilot.cycle-b' }] });
    const cyclicB = join(root, 'cycle-b');
    mkdirSync(cyclicB);
    writePlugin(cyclicB, { id: 'logicpilot.cycle-b', requires: [{ id: 'logicpilot.cycle-a' }] });
    const valid = join(root, 'valid');
    mkdirSync(valid);
    writePlugin(valid, { id: 'logicpilot.valid' });

    const catalog = await scanPluginCatalog({ roots: [{ scope: 'workspace', path: root }] });
    expect(catalog.entries).toHaveLength(3);
    const diagnostic = catalog.diagnostics.find(
      (candidate) => candidate.kind === 'dependency' && candidate.message.includes('cycle'),
    );
    expect(diagnostic?.pluginId).toBe('logicpilot.cycle-a');
  });

  it('warns for a missing configured root and still scans other roots', async () => {
    const root = tempRoot();
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.present' });
    const catalog = await scanPluginCatalog({
      roots: [
        { scope: 'system', path: join(tmpdir(), 'logicpilot-does-not-exist-iamafeature') },
        { scope: 'system', path: root },
      ],
    });
    expect(catalog.entries.map((entry) => entry.id)).toEqual(['logicpilot.present']);
    const diagnostic = catalog.diagnostics.find(
      (candidate) => candidate.kind === 'filesystem' && candidate.severity === 'warning',
    );
    expect(diagnostic?.rootId).toBe('system:1');
  });

  it('excludes package directories that escape their root (symlink/junction)', async () => {
    const root = tempRoot();
    const outside = tempRoot();
    const escape = join(outside, 'escapee');
    mkdirSync(escape);
    writePlugin(escape, { id: 'logicpilot.escapee' });
    const link = join(root, 'link-out');
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      return; // CI without symlink/junction rights cannot exercise this case.
    }
    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries).toEqual([]);
    const diagnostic = catalog.diagnostics.find(
      (candidate) => candidate.kind === 'filesystem' && candidate.severity === 'error',
    );
    expect(diagnostic?.path).toBe('link-out');
    expect(diagnostic?.message).toContain('escapes');
  });

  it('warns on a symlinked package directory even when it stays inside the root', async () => {
    const root = tempRoot();
    const realPkg = join(root, 'real-pkg');
    mkdirSync(realPkg);
    writePlugin(realPkg, { id: 'logicpilot.real' });
    const link = join(root, 'alias');
    try {
      symlinkSync(realPkg, link, 'junction');
    } catch {
      return;
    }
    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries.map((entry) => entry.path)).toEqual(['real-pkg']);
    expect(
      catalog.diagnostics.some(
        (diagnostic) =>
          diagnostic.kind === 'filesystem' &&
          diagnostic.severity === 'warning' &&
          diagnostic.path === 'alias',
      ),
    ).toBe(true);
  });

  it('ignores symlinked payload files when hashing (never follows links)', async () => {
    const root = tempRoot();
    const pkg = join(root, 'mixed');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.mixed' });
    writeAsset(pkg, 'real.txt', 'content');
    try {
      symlinkSync(join(pkg, 'real.txt'), join(pkg, 'link.txt'));
    } catch {
      return; // Windows without developer mode cannot create file symlinks.
    }
    const digest = expectedDigest([{ rel: 'real.txt', content: Buffer.from('content') }]);
    const catalog = await scanPluginCatalog({ roots: [{ scope: 'workspace', path: root }] });
    expect(catalog.entries[0]?.sha256).toBe(digest);
  });

  it('treats entrypoint paths as metadata only at scan time', async () => {
    const root = tempRoot();
    const pkg = join(root, 'traversal');
    mkdirSync(pkg);
    writePlugin(pkg, {
      id: 'logicpilot.traversal',
      entrypoints: { web: '../../../../outside.js' },
    });
    const catalog = await scanPluginCatalog({ roots: [{ scope: 'system', path: root }] });
    expect(catalog.entries[0]?.id).toBe('logicpilot.traversal');
    expect(catalog.diagnostics).toEqual([]);
  });

  it('is deterministic across scans of the same tree', async () => {
    const root = tempRoot();
    const pkg = join(root, 'stable');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.stable' });
    writeAsset(pkg, 'data/x.txt', '1');
    writeAsset(pkg, 'data/y.txt', '2');
    const first = await scanPluginCatalog({ roots: [{ scope: 'user', path: root }] });
    const second = await scanPluginCatalog({ roots: [{ scope: 'user', path: root }] });
    expect(first.entries).toEqual(second.entries);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  it('rejects a plugin.json that exceeds the size guard', async () => {
    const root = tempRoot();
    const pkg = join(root, 'huge');
    mkdirSync(pkg);
    writeFileSync(join(pkg, 'plugin.json'), '{ "padding": "' + 'x'.repeat(2048) + '" }');
    const catalog = await scanPluginCatalog({
      roots: [{ scope: 'system', path: root }],
      maxManifestBytes: 64,
    });
    expect(catalog.entries).toEqual([]);
    expect(catalog.diagnostics[0]?.kind).toBe('schema');
  });
});
