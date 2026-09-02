import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileSystemArtifactOutbox } from '../src/index.js';

const input = {
  artifactId: 'evidence:run-1',
  artifactKind: 'evidence',
  operationType: 'execution-evidence',
  payload: { runId: 'run-1', value: 1 },
  actor: 'runtime',
} as const;

describe('FileSystemArtifactOutbox', () => {
  it('is durable, idempotent and recovers processing entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-'));
    try {
      const first = new FileSystemArtifactOutbox({ rootDir: root });
      const created = first.enqueue(input);
      expect(first.enqueue({ ...input })).toEqual(created);
      expect(first.claimNext()?.status).toBe('processing');
      const restarted = new FileSystemArtifactOutbox({ rootDir: root });
      expect(restarted.list()[0]?.status).toBe('pending');
      expect(restarted.complete(created.id, 'rev-1')).toMatchObject({
        status: 'completed',
        resultRevisionId: 'rev-1',
      });
      expect(restarted.enqueue(input).status).toBe('completed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves exhausted entries to dead-letter and explicitly requeues them', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-dead-'));
    try {
      const outbox = new FileSystemArtifactOutbox({ rootDir: root, maxAttempts: 2 });
      const created = outbox.enqueue(input);
      outbox.claimNext();
      expect(outbox.fail(created.id, 'temporary failure').status).toBe('pending');
      outbox.claimNext();
      expect(outbox.fail(created.id, 'permanent failure').status).toBe('dead-letter');
      outbox.retryDeadLetters();
      expect(outbox.list()[0]).toMatchObject({ status: 'pending', attempts: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
