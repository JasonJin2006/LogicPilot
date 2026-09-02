import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemPackageStore, FileSystemPackageStoreError } from '../src/package-store.js';
import type { PluginLockfile } from '@logicpilot/contracts';
import { AuditLog, PackageManager } from '@logicpilot/plugin-host';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'logicpilot-package-store-'));
  roots.push(root);
  return root;
}

function lockfile(version = '1.0.0'): PluginLockfile {
  return {
    schema: 'logicpilot.plugin-lock/v1',
    contractVersion: 1,
    plugins: [
      {
        id: 'logicpilot.store-test',
        version,
        apiVersion: 1,
        sha256: 'a'.repeat(64),
        trust: 't0',
        permissions: [],
      },
    ],
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('FileSystemPackageStore', () => {
  it('writes and strictly validates a lockfile', () => {
    const root = tempRoot();
    const store = new FileSystemPackageStore({ rootDir: root });
    expect(store.readLockfile()).toBeNull();
    store.writeLockfile(lockfile());
    expect(store.readLockfile()).toEqual(lockfile());
    expect(store.readLockfileVersion()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a corrupt lockfile and unsafe store filenames', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'logicpilot.lock'), '{"schema":"wrong"}');
    const store = new FileSystemPackageStore({ rootDir: root });
    expect(() => store.readLockfile()).toThrow(FileSystemPackageStoreError);
    expect(() => new FileSystemPackageStore({ rootDir: root, lockfileName: '../outside' })).toThrow(
      /simple child names/,
    );
  });

  it('uses a snapshot for rollback and detects optimistic conflicts', () => {
    const root = tempRoot();
    const store = new FileSystemPackageStore({ rootDir: root });
    store.writeLockfile(lockfile('1.0.0'));
    const version = store.readLockfileVersion();
    store.snapshotLockfile();
    store.writeLockfileIfVersion(lockfile('2.0.0'), version);
    expect(store.readLockfile()?.plugins[0]?.version).toBe('2.0.0');
    expect(() => store.writeLockfileIfVersion(lockfile('3.0.0'), version)).toThrow(
      /changed concurrently/,
    );
    expect(store.readSnapshot()?.plugins[0]?.version).toBe('1.0.0');
  });

  it('appends bounded audit records without exposing arbitrary files', () => {
    const root = tempRoot();
    const store = new FileSystemPackageStore({ rootDir: root });
    store.appendAudit({
      seq: 1,
      timestamp: '2026-09-02T00:00:00Z',
      action: 'install',
      pluginId: 'logicpilot.store-test',
      detail: 'installed',
    });
    store.appendAudit({
      seq: 2,
      timestamp: '2026-09-02T00:00:01Z',
      action: 'grant',
      pluginId: 'logicpilot.store-test',
      detail: 'knowledge.draft.write',
    });
    expect(store.readAudit()).toHaveLength(2);
    expect(readFileSync(join(root, 'plugin-audit.jsonl'), 'utf8')).not.toContain(root);
    expect(() => store.readAudit(1)).toThrow(/read limit/);
  });

  it('recovers the target directory creation without requiring a pre-existing root', () => {
    const root = join(tempRoot(), 'nested', 'store');
    const store = new FileSystemPackageStore({ rootDir: root });
    store.writeLockfile(lockfile());
    expect(store.readLockfile()).not.toBeNull();
  });

  it('persists PackageManager actions through the optional audit sink', async () => {
    const root = tempRoot();
    const store = new FileSystemPackageStore({ rootDir: root });
    const manager = new PackageManager(store, new AuditLog());
    await manager.install({ manifestJson: lockManifest('logicpilot.audit-store') });
    expect(store.readAudit().map((entry) => entry.action)).toEqual(['install']);
  });
});

function lockManifest(id: string): Record<string, unknown> {
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
    integrity: { sha256: 'b'.repeat(64) },
  };
}
