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
});
