import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactStoreError, FileSystemArtifactStore } from '../src/index.js';
import { recoverAtomicFile } from '../src/atomic-file.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function stateFixture() {
  return {
    artifacts: [
      {
        schema: 'logicpilot.artifact/v1',
        contractVersion: 1,
        id: 'model.main',
        kind: 'semantic-model',
        createdAt: '2026-09-02T00:00:00Z',
        createdBy: 'user',
      },
    ],
    revisions: [],
    transactions: [],
  } as const;
}

describe('FileSystemArtifactStore', () => {
  it('persists validated state atomically and restores snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-store-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    store.write(stateFixture());
    store.snapshot();
    expect(store.read().artifacts[0]?.id).toBe('model.main');
    store.write({ artifacts: [], revisions: [], transactions: [] });
    expect(store.rollback().artifacts[0]?.id).toBe('model.main');
  });

  it('uses optimistic head CAS and rejects stale writers', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-cas-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    store.write(stateFixture());
    const revision = {
      schema: 'logicpilot.revision/v1',
      contractVersion: 1,
      id: 'rev-1',
      artifactId: 'model.main',
      createdAt: '2026-09-02T00:00:00Z',
      createdBy: 'agent',
      operations: [{ opId: 'op-1', opType: 'model-patch', payload: {} }],
      digest: 'a'.repeat(64),
    } as const;
    const transaction = {
      schema: 'logicpilot.transaction/v1',
      contractVersion: 1,
      id: 'tx-1',
      status: 'committed',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: revision.operations,
      committedRevisionId: 'rev-1',
      createdAt: '2026-09-02T00:00:00Z',
    } as const;
    store.compareAndSwap({ artifactId: 'model.main', revision, transaction });
    expect(() =>
      store.compareAndSwap({
        artifactId: 'model.main',
        expectedRevisionId: undefined,
        revision: { ...revision, id: 'rev-2' },
        transaction: { ...transaction, id: 'tx-2', committedRevisionId: 'rev-2' },
      }),
    ).toThrow(ArtifactStoreError);
  });

  it('persists the propose, validate, approve and commit lifecycle', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-lifecycle-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({
      rootDir: root,
      now: () => '2026-09-02T00:00:00Z',
    });
    const artifact = store.createArtifact({
      id: 'model.main',
      kind: 'semantic-model',
      createdBy: 'user',
    });
    const operation = { opId: 'op-1', opType: 'model-patch', payload: {} } as const;
    const proposed = store.propose({
      id: 'tx-1',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: artifact.id }],
      operations: [operation],
    });
    expect(proposed.status).toBe('proposed');
    expect(store.validate('tx-1').status).toBe('validated');
    expect(store.approve('tx-1', 'user').status).toBe('awaiting-approval');
    const revision = store.commit({
      transactionId: 'tx-1',
      revisionId: 'rev-1',
      artifactId: artifact.id,
      createdBy: 'agent',
      digest: 'b'.repeat(64),
    });
    expect(revision.parentRevisionId).toBeUndefined();
    expect(store.head(artifact.id)?.id).toBe('rev-1');
    expect(store.transaction('tx-1').status).toBe('committed');
    expect(store.read().revisions).toHaveLength(1);
  });

  it('replays an idempotent proposal and commit without creating a second revision', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-idempotency-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    const artifact = store.createArtifact({
      id: 'model.idempotent',
      kind: 'semantic-model',
      createdBy: 'user',
    });
    const input = {
      id: 'tx-first-attempt',
      idempotencyKey: 'artifact:stable-key',
      proposedBy: 'runtime',
      artifactRefs: [{ artifactId: artifact.id }],
      operations: [{ opId: 'op-stable', opType: 'model-save', payload: { value: 1 } }],
    } as const;
    const first = store.propose(input);
    const replay = store.propose({ ...input, id: 'tx-after-crash' });
    expect(replay.id).toBe(first.id);
    store.validate(first.id);
    store.approve(first.id, 'runtime');
    const commitInput = {
      transactionId: first.id,
      revisionId: 'rev-stable',
      artifactId: artifact.id,
      createdBy: 'runtime',
      digest: 'c'.repeat(64),
    } as const;
    expect(store.commit(commitInput).id).toBe('rev-stable');
    expect(store.commit({ ...commitInput, revisionId: 'rev-after-crash' }).id).toBe('rev-stable');
    expect(store.read().revisions).toHaveLength(1);
  });

  it('rejects a stale cross-process write instead of silently losing state', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-concurrency-'));
    roots.push(root);
    const first = new FileSystemArtifactStore({ rootDir: root });
    const second = new FileSystemArtifactStore({ rootDir: root });
    first.write(stateFixture());
    const stale = first.read();
    const staleVersion = first.version();
    second.write({
      ...stale,
      transactions: [
        {
          schema: 'logicpilot.transaction/v1',
          contractVersion: 1,
          id: 'tx-new',
          status: 'proposed',
          proposedBy: 'runtime',
          artifactRefs: [{ artifactId: 'model.main' }],
          operations: [{ opId: 'op-new', opType: 'probe', payload: {} }],
        },
      ],
    });
    expect(() =>
      first.write(
        { ...stale, artifacts: [...stale.artifacts, { ...stale.artifacts[0]!, id: 'new' }] },
        staleVersion,
      ),
    ).toThrow(/changed concurrently/);
  });

  it('rejects invalid operations without committing them', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-validation-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({
      rootDir: root,
      validateOperation: () => ['operation is not allowed'],
    });
    store.write(stateFixture());
    store.propose({
      id: 'tx-invalid',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: [{ opId: 'op-1', opType: 'model-patch', payload: {} }],
    });
    expect(() => store.validate('tx-invalid')).toThrow(/not allowed/);
    expect(store.transaction('tx-invalid').status).toBe('rejected');
    expect(store.read().revisions).toHaveLength(0);
  });

  it('closes an uncommitted transaction with a durable rollback record', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-rollback-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    store.write(stateFixture());
    store.propose({
      id: 'tx-rollback',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: [{ opId: 'op-1', opType: 'model-patch', payload: {} }],
    });
    const rolledBack = store.rollbackTransaction('tx-rollback', 'local-apply-failed');
    expect(rolledBack.status).toBe('rolled-back');
    expect(rolledBack.resolutionRecord).toBe('local-apply-failed');
    expect(() => store.rollbackTransaction('tx-rollback')).not.toThrow();
  });

  it('restores the atomic backup when the target file is missing after a crash', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-recover-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    store.write(stateFixture());
    const statePath = join(root, 'artifact-graph.json');
    const backupPath = `${statePath}.bak`;
    // Simulate a crash between the fallback's two renames: the target is gone
    // but the complete backup still exists.
    copyFileSync(statePath, backupPath);
    unlinkSync(statePath);
    expect(store.read().artifacts[0]?.id).toBe('model.main');
    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(backupPath)).toBe(false);
  });

  it('recovers both graph and snapshot backups during store startup', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-startup-recover-'));
    roots.push(root);
    const statePath = join(root, 'artifact-graph.json');
    const snapshotPath = join(root, 'artifact-graph.snapshot.json');
    writeFileSync(statePath, JSON.stringify(stateFixture()), 'utf8');
    writeFileSync(snapshotPath, JSON.stringify(stateFixture()), 'utf8');
    copyFileSync(statePath, `${statePath}.bak`);
    copyFileSync(snapshotPath, `${snapshotPath}.bak`);
    unlinkSync(statePath);
    unlinkSync(snapshotPath);
    const reopened = new FileSystemArtifactStore({ rootDir: root });
    expect(reopened.read().artifacts[0]?.id).toBe('model.main');
    expect(reopened.rollback().artifacts[0]?.id).toBe('model.main');
  });

  it('cleans crash-leftover temp files when recovering', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-tmp-'));
    roots.push(root);
    const statePath = join(root, 'artifact-graph.json');
    const leftover = `${statePath}.tmp-1-1-abc`;
    writeFileSync(leftover, 'junk', 'utf8');
    // Force the leftover to look stale (Windows mtimes can be a few ms ahead
    // of Date.now(), which would make a fresh file look "not yet stale").
    const past = new Date(Date.now() - 5_000);
    utimesSync(leftover, past, past);
    recoverAtomicFile(statePath, 0);
    expect(existsSync(leftover)).toBe(false);
  });

  it('does not reclaim a lock still held by a live process', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-live-lock-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root, mutexStaleMs: 1_000 });
    const mutex = join(root, 'artifact-graph.json.mutex');
    writeFileSync(mutex, JSON.stringify({ pid: process.pid, createdAt: 0, token: 'live' }));
    expect(() => store.write(stateFixture())).toThrow(/another process/);
  });

  it('reclaims a stale lock whose recorded owner is dead', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-dead-lock-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root, mutexStaleMs: 1_000 });
    const mutex = join(root, 'artifact-graph.json.mutex');
    // A dead pid (no process with that id) and an old timestamp.
    writeFileSync(mutex, JSON.stringify({ pid: 2147483647, createdAt: 0, token: 'dead' }));
    store.write(stateFixture());
    expect(store.read().artifacts[0]?.id).toBe('model.main');
  });

  it('leaves a complete snapshot even across concurrent graph rewrites', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-snapshot-'));
    roots.push(root);
    const store = new FileSystemArtifactStore({ rootDir: root });
    store.write(stateFixture());
    store.snapshot();
    const firstSnapshot = JSON.parse(
      readFileSync(join(root, 'artifact-graph.snapshot.json'), 'utf8'),
    ) as { artifacts?: { id?: string }[] };
    expect(firstSnapshot.artifacts?.[0]?.id).toBe('model.main');
    // A concurrent rewrite produces its own complete snapshot, never a
    // truncated or partially-serialized state.
    store.write({ ...stateFixture(), artifacts: [] });
    store.snapshot();
    const secondSnapshot = JSON.parse(
      readFileSync(join(root, 'artifact-graph.snapshot.json'), 'utf8'),
    ) as { artifacts?: unknown[]; revisions?: unknown[]; transactions?: unknown[] };
    expect(secondSnapshot.artifacts).toEqual([]);
    expect(secondSnapshot.revisions).toEqual([]);
    expect(secondSnapshot.transactions).toEqual([]);
    expect(store.read().artifacts).toEqual([]);
  });
});
