import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExecutionSession } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import {
  acquireSharedLock,
  atomicWriteFileSync,
  recoverAtomicFile,
  releaseSharedLock,
} from '@logicpilot/artifact-store';
import type { ExecutionRunStore } from '@logicpilot/plugin-host';

interface PersistedExecutionState {
  readonly schema: 'logicpilot.execution-run-store/v1';
  readonly contractVersion: 1;
  readonly sessions: readonly ExecutionSession[];
}

/** Atomic, lock-protected session snapshots. This store records lifecycle
 * state only; model revisions and run/evidence payloads remain in Artifact
 * Store/outbox. */
export class FileSystemExecutionRunStore implements ExecutionRunStore {
  private readonly rootDir: string;
  private readonly statePath: string;
  private readonly mutexPath: string;

  constructor(options: { readonly rootDir: string; readonly fileName?: string }) {
    this.rootDir = resolve(options.rootDir);
    const fileName = options.fileName ?? 'execution-sessions.json';
    this.statePath = join(this.rootDir, fileName);
    this.mutexPath = this.statePath + '.mutex';
    recoverAtomicFile(this.statePath);
  }

  list(): readonly ExecutionSession[] {
    if (!existsSync(this.statePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
    } catch {
      throw new Error('execution run store is not valid JSON');
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).schema !== 'logicpilot.execution-run-store/v1' ||
      (parsed as Record<string, unknown>).contractVersion !== 1 ||
      !Array.isArray((parsed as Record<string, unknown>).sessions)
    )
      throw new Error('execution run store has an invalid envelope');
    const sessions: ExecutionSession[] = [];
    for (const raw of (parsed as { sessions: unknown[] }).sessions) {
      const checked = validateContract('ExecutionSession', raw);
      if (!checked.ok)
        throw new Error('execution session is invalid: ' + checked.errors.join('; '));
      sessions.push(checked.value);
    }
    return sessions;
  }

  upsert(session: ExecutionSession): void {
    const checked = validateContract('ExecutionSession', session);
    if (!checked.ok) throw new Error('execution session is invalid: ' + checked.errors.join('; '));
    mkdirSync(this.rootDir, { recursive: true });
    // Upserts are intentionally tiny (one validated JSON snapshot). A crashed
    // app-server should be recoverable on the next launch instead of leaving a
    // thirty-minute stale lock from the general artifact store policy. The
    // owner-pid check still prevents stealing a live writer, while a crashed
    // app-server can be restarted immediately.
    const token = acquireSharedLock(this.mutexPath, {
      staleMs: 0,
      retryBudgetMs: 2_000,
    });
    if (token === null) throw new Error('execution run store is busy');
    try {
      const sessions = new Map(this.list().map((item) => [item.runId, item]));
      sessions.set(checked.value.runId, checked.value);
      const state: PersistedExecutionState = {
        schema: 'logicpilot.execution-run-store/v1',
        contractVersion: 1,
        sessions: [...sessions.values()],
      };
      atomicWriteFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n');
    } finally {
      releaseSharedLock(this.mutexPath, token);
    }
  }
}
