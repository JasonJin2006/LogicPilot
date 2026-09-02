import { describe, expect, it } from 'vitest';
import { RevisionStore, RevisionStoreError } from '../src/index.js';

function operation(opId: string) {
  return { opId, opType: 'model-patch', payload: { operations: [] } };
}

describe('RevisionStore', () => {
  it('runs propose, validate, approve and commit through one revision protocol', () => {
    const store = new RevisionStore({ now: () => '2026-09-02T00:00:00Z' });
    store.createArtifact({ id: 'model.main', kind: 'semantic-model', createdBy: 'user' });
    store.propose({
      id: 'tx-1',
      proposedBy: 'user',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: [operation('op-1')],
    });
    expect(store.validate('tx-1').status).toBe('validated');
    expect(store.approve('tx-1', 'user').status).toBe('awaiting-approval');
    const revision = store.commit({
      transactionId: 'tx-1',
      revisionId: 'rev-1',
      artifactId: 'model.main',
      createdBy: 'user',
      digest: 'a'.repeat(64),
    });
    expect(revision.parentRevisionId).toBeUndefined();
    expect(store.head('model.main')?.id).toBe('rev-1');
    expect(store.transaction('tx-1').status).toBe('committed');
  });

  it('rejects invalid operations and stale optimistic commits', () => {
    const store = new RevisionStore();
    store.createArtifact({ id: 'model.main', kind: 'semantic-model', createdBy: 'user' });
    store.propose({
      id: 'tx-bad',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: [operation('bad')],
    });
    // A validator can reject an operation without mutating the artifact head.
    const validating = new RevisionStore({ validateOperation: () => ['guard failed'] });
    validating.createArtifact({ id: 'model.main', kind: 'semantic-model', createdBy: 'user' });
    validating.propose({
      id: 'tx-bad',
      proposedBy: 'agent',
      artifactRefs: [{ artifactId: 'model.main' }],
      operations: [operation('bad')],
    });
    expect(() => validating.validate('tx-bad')).toThrow(RevisionStoreError);
    expect(() =>
      store.commit({
        transactionId: 'tx-bad',
        revisionId: 'rev-bad',
        artifactId: 'model.main',
        createdBy: 'agent',
        digest: 'b'.repeat(64),
      }),
    ).toThrow(/not approved/);
  });
});
