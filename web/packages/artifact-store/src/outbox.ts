import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { atomicWriteFileSync, recoverAtomicFile } from './atomic-file.js';
import { acquireSharedLock, isProcessAlive, releaseSharedLock } from './lock.js';

export type ArtifactOutboxStatus = 'pending' | 'processing' | 'completed' | 'dead-letter';
export interface ArtifactOutboxInput {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly operationType: string;
  readonly payload: unknown;
  readonly actor?: string;
}
export interface ArtifactOutboxEntry extends ArtifactOutboxInput {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly digest: string;
  readonly status: ArtifactOutboxStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resultRevisionId?: string;
  readonly lastError?: string;
  /** Internal claim lease: who holds an in-progress entry, and until when. */
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
}

/** Crash-recoverable server queue for background Artifact Graph writes. All
 * state transitions run read -> transform -> write while holding the mutex, so
 * concurrent enqueue/claim/complete from other processes cannot overwrite each
 * other. Claims carry a lease: a new outbox instance never resets an entry it
 * does not own, and an expired lease is only recovered lazily by the next
 * claim attempt. */
export class FileSystemArtifactOutbox {
  private readonly rootDir: string;
  private readonly path: string;
  private readonly mutexPath: string;
  private readonly maxAttempts: number;
  private readonly maxCompleted: number;
  private readonly leaseMs: number;
  private readonly mutexStaleMs: number;
  private readonly lockRetryBudgetMs: number;
  private readonly now: () => string;
  private readonly nowMs: () => number;

  constructor(options: {
    readonly rootDir: string;
    readonly fileName?: string;
    readonly maxAttempts?: number;
    readonly maxCompleted?: number;
    readonly leaseMs?: number;
    readonly mutexStaleMs?: number;
    readonly lockRetryBudgetMs?: number;
    readonly now?: () => string;
    readonly nowMs?: () => number;
  }) {
    this.rootDir = resolve(options.rootDir);
    this.path = join(this.rootDir, options.fileName ?? 'artifact-outbox.json');
    this.mutexPath = `${this.path}.mutex`;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxCompleted = options.maxCompleted ?? 128;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.mutexStaleMs = options.mutexStaleMs ?? 30 * 60 * 1000;
    this.lockRetryBudgetMs = options.lockRetryBudgetMs ?? 250;
    this.now = options.now ?? (() => new Date().toISOString());
    this.nowMs = options.nowMs ?? (() => Date.now());
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new Error('artifact outbox maxAttempts must be positive');
    if (!Number.isSafeInteger(this.maxCompleted) || this.maxCompleted < 1)
      throw new Error('artifact outbox maxCompleted must be positive');
    if (!Number.isSafeInteger(this.leaseMs) || this.leaseMs < 1)
      throw new Error('artifact outbox leaseMs must be positive');
    if (!Number.isSafeInteger(this.mutexStaleMs) || this.mutexStaleMs < 1_000)
      throw new Error('artifact outbox mutexStaleMs must be at least one second');
    if (!Number.isSafeInteger(this.lockRetryBudgetMs) || this.lockRetryBudgetMs < 0)
      throw new Error('artifact outbox lockRetryBudgetMs must be a non-negative integer');
  }

  list(): readonly ArtifactOutboxEntry[] {
    recoverAtomicFile(this.path);
    if (!existsSync(this.path)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      throw new Error('artifact outbox is not valid JSON');
    }
    if (!Array.isArray(parsed)) throw new Error('artifact outbox must be an array');
    return parsed.map(validateEntry);
  }

  enqueue(input: ArtifactOutboxInput): ArtifactOutboxEntry {
    const digest = digestInput(input);
    const idempotencyKey = `artifact:${digest}`;
    const updated = this.mutate((current) => {
      if (current.some((entry) => entry.idempotencyKey === idempotencyKey)) return current;
      const timestamp = this.now();
      const entry: ArtifactOutboxEntry = {
        ...input,
        id: `outbox-${digest}`,
        idempotencyKey,
        digest,
        status: 'pending',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return [...current, entry];
    });
    const found = updated.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (!found) throw new Error('artifact outbox enqueue failed');
    return found;
  }

  /** Claim the next pending entry, taking a lease. Expired processing leases
   * are recovered back to pending first. Returns undefined when no work is
   * available. */
  claimNext(): ArtifactOutboxEntry | undefined {
    let claimed: ArtifactOutboxEntry | undefined;
    this.mutate((current) => {
      const recovered = current.map((entry) => this.recoverExpired(entry));
      const next = recovered.find((entry) => entry.status === 'pending');
      if (!next) return recovered;
      const nowMs = this.nowMs();
      claimed = {
        ...next,
        status: 'processing' as const,
        updatedAt: this.now(),
        leaseOwner: String(process.pid),
        leaseToken: randomLeaseToken(),
        leaseExpiresAt: new Date(nowMs + this.leaseMs).toISOString(),
      };
      return recovered.map((entry) => (entry.id === next.id ? claimed! : entry));
    });
    return claimed;
  }

  complete(id: string, resultRevisionId?: string, leaseToken?: string): ArtifactOutboxEntry {
    return this.update(id, leaseToken, (entry) => ({
      ...entry,
      status: 'completed',
      updatedAt: this.now(),
      ...(resultRevisionId === undefined ? {} : { resultRevisionId }),
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    }));
  }

  fail(id: string, error: string, leaseToken?: string): ArtifactOutboxEntry {
    return this.update(id, leaseToken, (entry) => {
      const attempts = entry.attempts + 1;
      return {
        ...entry,
        attempts,
        status: attempts >= this.maxAttempts ? 'dead-letter' : 'pending',
        updatedAt: this.now(),
        lastError: error.slice(0, 512),
        leaseOwner: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
      };
    });
  }

  retryDeadLetters(): void {
    this.mutate((current) =>
      current.map((entry) =>
        entry.status === 'dead-letter'
          ? {
              ...entry,
              status: 'pending' as const,
              attempts: 0,
              updatedAt: this.now(),
              leaseOwner: undefined,
              leaseToken: undefined,
              leaseExpiresAt: undefined,
            }
          : entry,
      ),
    );
  }

  private recoverExpired(entry: ArtifactOutboxEntry): ArtifactOutboxEntry {
    if (entry.status !== 'processing') return entry;
    const ownerDead =
      entry.leaseOwner !== undefined &&
      Number.isSafeInteger(Number(entry.leaseOwner)) &&
      !isProcessAlive(Number(entry.leaseOwner));
    const leaseExpired =
      entry.leaseExpiresAt !== undefined && Date.parse(entry.leaseExpiresAt) <= this.nowMs();
    if (!leaseExpired && !ownerDead) return entry;
    return {
      ...entry,
      status: 'pending',
      updatedAt: this.now(),
      leaseOwner: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    };
  }

  private update(
    id: string,
    leaseToken: string | undefined,
    transform: (entry: ArtifactOutboxEntry) => ArtifactOutboxEntry,
  ): ArtifactOutboxEntry {
    let result: ArtifactOutboxEntry | undefined;
    this.mutate((current) => {
      const entry = current.find((candidate) => candidate.id === id);
      if (!entry) throw new Error(`artifact outbox entry '${id}' was not found`);
      if (entry.status === 'completed') {
        result = entry;
        return current;
      }
      if (entry.status !== 'processing' || entry.leaseToken !== leaseToken) {
        throw new Error(`artifact outbox entry '${id}' is leased by another owner`);
      }
      result = transform(entry);
      return current.map((candidate) => (candidate.id === id ? result! : candidate));
    });
    if (!result) throw new Error(`artifact outbox entry '${id}' was not updated`);
    return result;
  }

  private mutate(
    transform: (entries: readonly ArtifactOutboxEntry[]) => readonly ArtifactOutboxEntry[],
  ): readonly ArtifactOutboxEntry[] {
    mkdirSync(this.rootDir, { recursive: true });
    const token = acquireSharedLock(this.mutexPath, {
      staleMs: this.mutexStaleMs,
      retryBudgetMs: this.lockRetryBudgetMs,
    });
    if (token === null) throw new Error('artifact outbox is being written by another process');
    try {
      const current = this.list();
      const next = transform(current);
      this.persist(next);
      return next;
    } finally {
      releaseSharedLock(this.mutexPath, token);
    }
  }

  private persist(entries: readonly ArtifactOutboxEntry[]): void {
    const active = entries.filter((entry) => entry.status !== 'completed');
    const completed = entries
      .filter((entry) => entry.status === 'completed')
      .slice(-this.maxCompleted);
    atomicWriteFileSync(this.path, `${JSON.stringify([...active, ...completed], null, 2)}\n`);
  }
}

export function digestInput(input: ArtifactOutboxInput): string {
  const businessInput = {
    artifactId: input.artifactId,
    artifactKind: input.artifactKind,
    operationType: input.operationType,
    payload: input.payload,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
  };
  return createHash('sha256').update(stableJson(businessInput)).digest('hex');
}

export function randomLeaseToken(): string {
  return randomBytes(16).toString('hex');
}

function validateEntry(value: unknown): ArtifactOutboxEntry {
  if (typeof value !== 'object' || value === null)
    throw new Error('artifact outbox entry is invalid');
  const entry = value as Partial<ArtifactOutboxEntry>;
  if (
    typeof entry.id !== 'string' ||
    typeof entry.idempotencyKey !== 'string' ||
    typeof entry.digest !== 'string' ||
    typeof entry.artifactId !== 'string' ||
    typeof entry.artifactKind !== 'string' ||
    typeof entry.operationType !== 'string' ||
    !['pending', 'processing', 'completed', 'dead-letter'].includes(entry.status ?? '') ||
    !Number.isSafeInteger(entry.attempts) ||
    typeof entry.createdAt !== 'string' ||
    typeof entry.updatedAt !== 'string'
  )
    throw new Error('artifact outbox entry has invalid fields');
  return entry as ArtifactOutboxEntry;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
