import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { FileSystemArtifactOutbox } from '../src/index.js';

const distModuleUrl = new URL('../dist/index.js', import.meta.url).href;
const input = {
  artifactId: 'evidence:run-1',
  artifactKind: 'evidence',
  operationType: 'execution-evidence',
  payload: { runId: 'run-1', value: 1 },
  actor: 'runtime',
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const concurrentEnqueueScript = (modulePath: string) => `
  import { FileSystemArtifactOutbox } from ${JSON.stringify(modulePath)};
  const [root, worker] = process.argv.slice(1);
  const outbox = new FileSystemArtifactOutbox({ rootDir: root });
  const spin = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
  for (let i = 0; i < 40; i += 1) {
    const item = { artifactId: 'model.main', artifactKind: 'semantic-model', operationType: 'end-to-end', payload: { worker, i }, actor: 'test' };
    for (let attempt = 0; ; attempt += 1) {
      try {
        outbox.enqueue(item);
        break;
      } catch (error) {
        // Transient lock contention is retried by the caller; a write that
        // succeeds is never lost even when another process races it.
        if (!/another process/.test(String(error?.message ?? error)) || attempt >= 25) throw error;
        spin(15);
      }
    }
  }
`;

const claimAndHoldScript = (modulePath: string, readyFile: string) => `
  import { writeFileSync } from 'node:fs';
  import { FileSystemArtifactOutbox } from ${JSON.stringify(modulePath)};
  const [root] = process.argv.slice(1);
  const outbox = new FileSystemArtifactOutbox({ rootDir: root, leaseMs: 120_000 });
  const claim = outbox.claimNext();
  writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify(claim ?? null), 'utf8');
  setInterval(() => {}, 1000);
`;

function launch(code: string, args: string[]) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let err = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    err += chunk.toString();
  });
  return { child, output: () => output, err: () => err };
}

describe('FileSystemArtifactOutbox', () => {
  it('is durable and idempotent; a fresh instance never steals an active lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-'));
    try {
      const first = new FileSystemArtifactOutbox({ rootDir: root });
      const created = first.enqueue(input);
      expect(first.enqueue({ ...input })).toEqual(created);
      const claimed = first.claimNext();
      expect(claimed?.status).toBe('processing');
      expect(claimed?.leaseToken).toBeTruthy();
      const restarted = new FileSystemArtifactOutbox({ rootDir: root });
      expect(restarted.list()[0]?.status).toBe('processing');
      expect(() => restarted.complete(created.id, 'rev-1', 'wrong-token')).toThrow(
        /leased by another owner/,
      );
      expect(restarted.complete(created.id, 'rev-1', claimed?.leaseToken)).toMatchObject({
        status: 'completed',
        resultRevisionId: 'rev-1',
      });
      expect(restarted.enqueue(input).status).toBe('completed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers an expired processing lease back to pending', async () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-lease-'));
    try {
      const outbox = new FileSystemArtifactOutbox({ rootDir: root, leaseMs: 30 });
      const created = outbox.enqueue(input);
      expect(outbox.claimNext()?.status).toBe('processing');
      await sleep(80);
      const reclaimed = outbox.claimNext();
      expect(reclaimed?.id).toBe(created.id);
      expect(reclaimed?.status).toBe('processing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('moves exhausted entries to dead-letter and explicitly requeues them', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-dead-'));
    try {
      const outbox = new FileSystemArtifactOutbox({ rootDir: root, maxAttempts: 2 });
      const created = outbox.enqueue(input);
      const firstClaim = outbox.claimNext();
      expect(outbox.fail(created.id, 'temporary failure', firstClaim?.leaseToken).status).toBe(
        'pending',
      );
      const secondClaim = outbox.claimNext();
      expect(outbox.fail(created.id, 'permanent failure', secondClaim?.leaseToken).status).toBe(
        'dead-letter',
      );
      outbox.retryDeadLetters();
      expect(outbox.list()[0]).toMatchObject({ status: 'pending', attempts: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not lose concurrent enqueues from two live processes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-concurrent-'));
    try {
      const code = concurrentEnqueueScript(distModuleUrl);
      const a = launch(code, [root, '1']);
      const b = launch(code, [root, '2']);
      const [codeA, codeB] = await Promise.all([once(a.child, 'exit'), once(b.child, 'exit')]);
      if (codeA[0] !== 0) throw new Error(`worker A failed: ${a.err()}`);
      if (codeB[0] !== 0) throw new Error(`worker B failed: ${b.err()}`);
      expect(codeA[0]).toBe(0);
      expect(codeB[0]).toBe(0);
      const outbox = new FileSystemArtifactOutbox({ rootDir: root });
      const ids = outbox.list().map((entry) => entry.id);
      expect(ids).toHaveLength(2 * 40);
      expect(new Set(ids).size).toBe(2 * 40);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prevents a second process from claiming a live-owner entry, then reclaims it on owner death', async () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-artifact-outbox-claim-'));
    const ready = join(root, 'claimed.json');
    try {
      const outbox = new FileSystemArtifactOutbox({ rootDir: root });
      const created = outbox.enqueue(input);
      const holder = launch(claimAndHoldScript(distModuleUrl, ready), [root]);
      // Wait for the holder to claim and report.
      for (let i = 0; i < 50 && !existsSync(ready); i += 1) await sleep(20);
      expect(existsSync(ready)).toBe(true);
      const claimed = JSON.parse(readFileSync(ready, 'utf8'));
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe('processing');
      // While the owner is alive, a second process must not get the entry.
      const second = new FileSystemArtifactOutbox({ rootDir: root });
      expect(second.claimNext()).toBeUndefined();
      // Kill the owner; the dead-owner lease is reclaimable on the next claim.
      holder.child.kill('SIGKILL');
      await once(holder.child, 'exit').catch(() => undefined);
      await sleep(50);
      expect(second.claimNext()?.id).toBe(created.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
