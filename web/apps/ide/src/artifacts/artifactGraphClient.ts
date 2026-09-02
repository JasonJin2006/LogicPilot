import type { ModelDocument, ModelPatch } from '@logicpilot/editor';
import { getAppConfig, sessionHeaders } from '../state/appConfig';

const MODEL_ARTIFACT_ID = 'workspace.model';

interface ArtifactGraphView {
  readonly configured?: boolean;
  readonly artifacts: readonly { readonly id: string; readonly kind: string }[];
  readonly revisions: readonly {
    readonly id: string;
    readonly artifactId: string;
  }[];
}

interface OperationResponse<T> {
  readonly result: T;
}

export interface PendingArtifactTransaction {
  readonly enabled: boolean;
  readonly transactionId?: string;
  readonly artifactId?: string;
  readonly digest?: string;
}

export interface ArtifactTransactionInput {
  readonly artifactId: string;
  readonly artifactKind: 'semantic-model' | 'source-document' | 'view-layout' | 'evidence' | 'run';
  readonly operationType: string;
  readonly payload: unknown;
  readonly actor?: string;
}

export interface ArtifactOutboxRecord {
  readonly input: ArtifactTransactionInput;
  readonly attempts: number;
  readonly lastError?: string;
}

export interface ArtifactOutboxStorage {
  read(): readonly (ArtifactTransactionInput | ArtifactOutboxRecord)[];
  write(items: readonly (ArtifactTransactionInput | ArtifactOutboxRecord)[]): void;
}

class BrowserArtifactOutboxStorage implements ArtifactOutboxStorage {
  private readonly key = 'logicpilot.artifact.outbox.v1';

  read(): readonly (ArtifactTransactionInput | ArtifactOutboxRecord)[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is ArtifactTransactionInput | ArtifactOutboxRecord => {
            if (typeof item !== 'object' || item === null) return false;
            const record = item as { input?: unknown; attempts?: unknown };
            if (record.input !== undefined) {
              const input = record.input as { artifactId?: unknown; operationType?: unknown };
              return (
                typeof input === 'object' &&
                input !== null &&
                typeof input.artifactId === 'string' &&
                typeof input.operationType === 'string' &&
                typeof record.attempts === 'number'
              );
            }
            return (
              typeof (item as { artifactId?: unknown }).artifactId === 'string' &&
              typeof (item as { operationType?: unknown }).operationType === 'string'
            );
          })
        : [];
    } catch {
      return [];
    }
  }

  write(items: readonly (ArtifactTransactionInput | ArtifactOutboxRecord)[]): void {
    if (typeof window === 'undefined') return;
    try {
      const encoded = JSON.stringify(items);
      if (encoded.length > 1024 * 1024) throw new Error('artifact outbox exceeds 1 MiB');
      window.localStorage.setItem(this.key, encoded);
    } catch {
      // A private/quota-limited browser storage must not break local editing;
      // the queue still retains in-memory items for this process.
    }
  }
}

/** Serializes background Artifact Graph writes (layout/evidence/run) so two
 * rapid UI events never propose against the same stale head. Foreground model
 * edits keep using direct transactions so conflicts remain visible to the
 * caller. */
export class ArtifactSyncQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly storage: ArtifactOutboxStorage;
  private readonly pending = new Map<string, ArtifactOutboxRecord>();
  private readonly deadLetters = new Map<string, ArtifactOutboxRecord>();
  private readonly results = new Map<string, Promise<string | undefined>>();
  private readonly maxAttempts: number;

  constructor(
    storage: ArtifactOutboxStorage = new BrowserArtifactOutboxStorage(),
    options: { readonly maxAttempts?: number } = {},
  ) {
    this.storage = storage;
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1)
      throw new Error('artifact sync maxAttempts must be a positive integer');
    for (const item of storage.read()) {
      const record = isOutboxRecord(item) ? item : { input: item, attempts: 0 };
      this.pending.set(this.keyOf(record.input), record);
    }
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  flush(): Promise<void> {
    return this.tail;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  deadLetterCount(): number {
    return this.deadLetters.size;
  }

  enqueueTransaction(
    input: ArtifactTransactionInput,
    onFailure?: () => void,
  ): Promise<string | undefined> {
    const key = this.keyOf(input);
    const existing = this.results.get(key);
    if (existing) return existing;
    const previous = this.pending.get(key);
    this.pending.set(key, previous ?? { input, attempts: 0 });
    this.persistPending();
    const result = this.enqueue(async () => {
      const pending = await beginArtifactTransaction(input);
      if (!pending.enabled) throw new Error('artifact graph is not configured or unavailable');
      try {
        return await commitArtifactTransaction(pending, input.actor ?? 'runtime');
      } catch (error) {
        await rollbackArtifactTransaction(pending, 'background-transaction-failed').catch(
          () => undefined,
        );
        onFailure?.();
        throw error;
      }
    });
    const settled = result.then(
      (value) => {
        this.pending.delete(key);
        this.results.delete(key);
        this.persistPending();
        return value;
      },
      (error) => {
        this.results.delete(key);
        const current = this.pending.get(key);
        if (current !== undefined) {
          const failed: ArtifactOutboxRecord = {
            ...current,
            attempts: current.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error),
          };
          if (failed.attempts >= this.maxAttempts) {
            this.pending.delete(key);
            this.deadLetters.set(key, failed);
          } else {
            this.pending.set(key, failed);
          }
          this.persistPending();
        }
        // Keep retryable items in the outbox; exhausted items become an
        // explicit dead letter instead of retrying forever in the background.
        throw error;
      },
    );
    this.results.set(key, settled);
    return settled;
  }

  /** Retry all persisted items after app-server/runtime recovery. */
  drain(): Promise<void> {
    for (const { input } of [...this.pending.values()]) this.enqueueTransaction(input);
    return this.flush();
  }

  /** Explicitly requeue exhausted items after an operator/user decision. */
  retryDeadLetters(): void {
    for (const [key, record] of this.deadLetters) {
      this.pending.set(key, { input: record.input, attempts: 0 });
      this.deadLetters.delete(key);
    }
    this.persistPending();
  }

  private keyOf(input: ArtifactTransactionInput): string {
    return `${input.artifactId}:${input.operationType}:${canonicalize(input.payload)}`;
  }

  private persistPending(): void {
    this.storage.write([...this.pending.values()]);
  }
}

function isOutboxRecord(
  value: ArtifactTransactionInput | ArtifactOutboxRecord,
): value is ArtifactOutboxRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input' in value &&
    typeof value.input === 'object' &&
    value.input !== null &&
    typeof value.attempts === 'number'
  );
}

export const ARTIFACT_SYNC_QUEUE = new ArtifactSyncQueue();

function requestUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, '')}/api/artifact-graph`;
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}

async function sha256Hex(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for artifact revision digests');
  }
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function call<T>(
  apiBase: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(requestUrl(apiBase), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`artifact graph request failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

/** Begin a server-side transaction for any supported artifact operation. In
 * unit-test/SSR environments there is no app server, so the local editor
 * remains usable and the returned transaction is explicitly disabled rather
 * than silently pretending it was persisted. */
export async function beginArtifactTransaction(
  input: ArtifactTransactionInput,
): Promise<PendingArtifactTransaction> {
  if (typeof window === 'undefined') return { enabled: false };
  const config = await getAppConfig();
  if (!config) return { enabled: false };
  const headers = sessionHeaders(config);
  const graph = await call<ArtifactGraphView>(config.apiBase, headers);
  // A development server may intentionally run without a persistence root.
  // Keep the local editor usable, but make the absence explicit to callers.
  if (graph.configured === false) return { enabled: false };
  if (!graph.artifacts.some((artifact) => artifact.id === input.artifactId)) {
    await call(config.apiBase, headers, {
      action: 'create-artifact',
      input: {
        id: input.artifactId,
        kind: input.artifactKind,
        createdBy: input.actor ?? 'agent',
      },
    });
  }
  const head = graph.revisions
    .filter((revision) => revision.artifactId === input.artifactId)
    .at(-1);
  // Derive the operation and idempotency identities from the logical input,
  // not from process-local random ids. A browser crash between commit and
  // outbox cleanup can therefore safely replay the exact same transaction.
  const inputDigest = await sha256Hex({
    artifactId: input.artifactId,
    operationType: input.operationType,
    payload: input.payload,
  });
  const operation = {
    opId: `op-${inputDigest}`,
    opType: input.operationType,
    payload: input.payload,
  };
  const transactionId = randomId('tx');
  await call(config.apiBase, headers, {
    action: 'propose',
    input: {
      id: transactionId,
      idempotencyKey: `artifact:${inputDigest}`,
      proposedBy: input.actor ?? 'agent',
      artifactRefs: [{ artifactId: input.artifactId, ...(head ? { revisionId: head.id } : {}) }],
      operations: [operation],
    },
  });
  await call(config.apiBase, headers, { action: 'validate', transactionId });
  return {
    enabled: true,
    transactionId,
    artifactId: input.artifactId,
    digest: await sha256Hex({ artifactId: input.artifactId, operations: [operation] }),
  };
}

export async function beginModelPatchTransaction(
  patch: ModelPatch,
  actor = 'agent',
): Promise<PendingArtifactTransaction> {
  return beginArtifactTransaction({
    artifactId: MODEL_ARTIFACT_ID,
    artifactKind: 'semantic-model',
    operationType: 'model-patch',
    payload: patch,
    actor,
  });
}

/** Approve and commit a transaction after local application and compilation
 * have succeeded. If either phase fails, callers should invoke rollback. */
export async function commitArtifactTransaction(
  pending: PendingArtifactTransaction,
  actor = 'user',
): Promise<string | undefined> {
  if (!pending.enabled) return undefined;
  if (!pending.transactionId || !pending.artifactId || !pending.digest)
    throw new Error('artifact transaction is incomplete');
  const config = await getAppConfig();
  if (!config) throw new Error('app server is unavailable for artifact commit');
  const headers = sessionHeaders(config);
  await call(config.apiBase, headers, {
    action: 'approve',
    transactionId: pending.transactionId,
    approvedBy: actor,
  });
  const committed = await call<OperationResponse<{ readonly id: string }>>(
    config.apiBase,
    headers,
    {
      action: 'commit',
      input: {
        transactionId: pending.transactionId,
        revisionId: randomId('rev'),
        artifactId: pending.artifactId,
        createdBy: 'agent',
        digest: pending.digest,
      },
    },
  );
  return committed.result.id;
}

export async function commitModelPatchTransaction(
  pending: PendingArtifactTransaction,
  actor = 'user',
): Promise<string | undefined> {
  return commitArtifactTransaction(pending, actor);
}

export async function rollbackArtifactTransaction(
  pending: PendingArtifactTransaction,
  reason: string,
): Promise<void> {
  if (!pending.enabled || !pending.transactionId) return;
  const config = await getAppConfig();
  if (!config) return;
  await call(config.apiBase, sessionHeaders(config), {
    action: 'rollback',
    transactionId: pending.transactionId,
    resolutionRecord: reason,
  });
}

export async function rollbackModelPatchTransaction(
  pending: PendingArtifactTransaction,
  reason: string,
): Promise<void> {
  return rollbackArtifactTransaction(pending, reason);
}

export async function persistEvidenceArtifact(
  path: string,
  record: unknown,
): Promise<string | undefined> {
  return ARTIFACT_SYNC_QUEUE.enqueueTransaction({
    artifactId: `evidence:${path}:${
      typeof record === 'object' && record !== null && 'id' in record
        ? String((record as { id: unknown }).id)
        : 'unknown'
    }`,
    artifactKind: 'evidence',
    operationType: 'execution-evidence',
    payload: record,
    actor: 'runtime',
  });
}

/** Persist a user Save as a semantic-model revision. Individual canvas edits
 * stay responsive locally; Save is the durable transaction boundary for the
 * canonical document snapshot. */
export async function persistModelSnapshot(
  document: ModelDocument,
  actor = 'user',
): Promise<string | undefined> {
  const pending = await beginArtifactTransaction({
    artifactId: MODEL_ARTIFACT_ID,
    artifactKind: 'semantic-model',
    operationType: 'model-save',
    payload: { document },
    actor,
  });
  try {
    return await commitArtifactTransaction(pending, actor);
  } catch (error) {
    await rollbackArtifactTransaction(pending, 'model-save-commit-failed').catch(() => undefined);
    throw error;
  }
}

/** Persist a simulation execution and bind it to the model revision known by
 * the assistant session. The run artifact is immutable and can be queried
 * independently of the current canvas head. */
export async function persistRunArtifact(input: {
  readonly modelRevisionId?: string;
  readonly result: unknown;
}): Promise<string | undefined> {
  return ARTIFACT_SYNC_QUEUE.enqueueTransaction({
    artifactId: `run:${randomId('execution')}`,
    artifactKind: 'run',
    operationType: 'simulation-run',
    payload: {
      modelRevisionId: input.modelRevisionId ?? null,
      result: input.result,
    },
    actor: 'runtime',
  });
}

export { MODEL_ARTIFACT_ID, canonicalize, sha256Hex };
