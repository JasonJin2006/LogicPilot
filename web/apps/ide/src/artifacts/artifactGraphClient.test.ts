import { describe, expect, it } from 'vitest';
import {
  ArtifactSyncQueue,
  type ArtifactOutboxRecord,
  type ArtifactTransactionInput,
} from './artifactGraphClient';

describe('ArtifactSyncQueue', () => {
  it('hydrates legacy inputs and bounded outbox records', () => {
    const input: ArtifactTransactionInput = {
      artifactId: 'evidence:one',
      artifactKind: 'evidence',
      operationType: 'execution-evidence',
      payload: { id: 'one' },
    };
    const record: ArtifactOutboxRecord = { input, attempts: 2, lastError: 'offline' };
    const storage = {
      read: () => [record],
      write: () => undefined,
    };
    const queue = new ArtifactSyncQueue(storage);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);
  });

  it('serializes background writes and keeps the queue usable after failure', async () => {
    const queue = new ArtifactSyncQueue();
    const order: string[] = [];
    const first = queue.enqueue(async () => {
      order.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first-end');
      return 1;
    });
    const second = queue.enqueue(async () => {
      order.push('second');
      return 2;
    });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);

    await expect(
      queue.enqueue(async () => {
        throw new Error('expected');
      }),
    ).rejects.toThrow('expected');
    await expect(queue.enqueue(async () => 3)).resolves.toBe(3);
    await expect(queue.flush()).resolves.toBeUndefined();
  });
});
