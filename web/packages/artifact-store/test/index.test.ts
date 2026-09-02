import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactStoreError, FileSystemArtifactStore } from '../src/index.js';

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
});
