import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

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
}

/** Crash-recoverable server queue for background Artifact Graph writes. */
export class FileSystemArtifactOutbox {
  private readonly rootDir: string;
  private readonly path: string;
  private readonly mutexPath: string;
  private readonly maxAttempts: number;
  private readonly maxCompleted: number;
  private readonly now: () => string;

  constructor(options: {
    readonly rootDir: string;
    readonly fileName?: string;
    readonly maxAttempts?: number;
    readonly maxCompleted?: number;
    readonly now?: () => string;
  }) {
    this.rootDir = resolve(options.rootDir);
    this.path = join(this.rootDir, options.fileName ?? 'artifact-outbox.json');
    this.mutexPath = `${this.path}.mutex`;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.maxCompleted = options.maxCompleted ?? 128;
    this.now = options.now ?? (() => new Date().toISOString());
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new Error('artifact outbox maxAttempts must be positive');
    if (!Number.isSafeInteger(this.maxCompleted) || this.maxCompleted < 1)
      throw new Error('artifact outbox maxCompleted must be positive');
    this.recoverProcessing();
  }

  list(): readonly ArtifactOutboxEntry[] {
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
    const current = this.list();
    const existing = current.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existing) return existing;
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
    this.write([...current, entry]);
    return entry;
  }

  claimNext(): ArtifactOutboxEntry | undefined {
    const current = this.list();
    const next = current.find((entry) => entry.status === 'pending');
    if (!next) return undefined;
    const claimed = { ...next, status: 'processing' as const, updatedAt: this.now() };
    this.write(current.map((entry) => (entry.id === next.id ? claimed : entry)));
    return claimed;
  }

  complete(id: string, resultRevisionId?: string): ArtifactOutboxEntry {
    return this.update(id, (entry) => ({
      ...entry,
      status: 'completed',
      updatedAt: this.now(),
      ...(resultRevisionId === undefined ? {} : { resultRevisionId }),
    }));
  }

  fail(id: string, error: string): ArtifactOutboxEntry {
    return this.update(id, (entry) => {
      const attempts = entry.attempts + 1;
      return {
        ...entry,
        attempts,
        status: attempts >= this.maxAttempts ? 'dead-letter' : 'pending',
        updatedAt: this.now(),
        lastError: error.slice(0, 512),
      };
    });
  }

  retryDeadLetters(): void {
    const current = this.list();
    this.write(
      current.map((entry) =>
        entry.status === 'dead-letter'
          ? { ...entry, status: 'pending', attempts: 0, updatedAt: this.now() }
          : entry,
      ),
    );
  }

  private update(id: string, transform: (entry: ArtifactOutboxEntry) => ArtifactOutboxEntry) {
    const current = this.list();
    const entry = current.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`artifact outbox entry '${id}' was not found`);
    const updated = transform(entry);
    this.write([...current.filter((candidate) => candidate.id !== id), updated]);
    return updated;
  }

  private recoverProcessing(): void {
    const current = this.list();
    if (current.some((entry) => entry.status === 'processing'))
      this.write(
        current.map((entry) =>
          entry.status === 'processing'
            ? { ...entry, status: 'pending', updatedAt: this.now() }
            : entry,
        ),
      );
  }

  private write(entries: readonly ArtifactOutboxEntry[]): void {
    mkdirSync(this.rootDir, { recursive: true });
    if (!this.acquireMutex())
      throw new Error('artifact outbox is being written by another process');
    try {
      const active = entries.filter((entry) => entry.status !== 'completed');
      const completed = entries
        .filter((entry) => entry.status === 'completed')
        .slice(-this.maxCompleted);
      const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`;
      try {
        writeFileSync(temporary, `${JSON.stringify([...active, ...completed], null, 2)}\n`, 'utf8');
        try {
          renameSync(temporary, this.path);
        } catch {
          if (existsSync(this.path)) unlinkSync(this.path);
          renameSync(temporary, this.path);
        }
      } catch {
        if (existsSync(temporary)) unlinkSync(temporary);
        throw new Error('cannot atomically write artifact outbox');
      }
    } finally {
      if (existsSync(this.mutexPath)) unlinkSync(this.mutexPath);
    }
  }

  private acquireMutex(): boolean {
    try {
      writeFileSync(this.mutexPath, JSON.stringify({ createdAt: Date.now() }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      return true;
    } catch {
      if (!existsSync(this.mutexPath)) return false;
      try {
        const marker = JSON.parse(readFileSync(this.mutexPath, 'utf8')) as { createdAt?: unknown };
        if (typeof marker.createdAt !== 'number' || Date.now() - marker.createdAt < 30 * 60 * 1000)
          return false;
        unlinkSync(this.mutexPath);
        writeFileSync(this.mutexPath, JSON.stringify({ createdAt: Date.now() }), {
          encoding: 'utf8',
          flag: 'wx',
        });
        return true;
      } catch {
        return false;
      }
    }
  }
}

export function digestInput(input: ArtifactOutboxInput): string {
  return createHash('sha256').update(stableJson(input)).digest('hex');
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
