import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  Artifact,
  ArtifactKind,
  ArtifactRef,
  Revision,
  Transaction,
  TypedOperation,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
export * from './outbox.js';
export { atomicWriteFileSync, recoverAtomicFile } from './atomic-file.js';
export { acquireSharedLock, releaseSharedLock } from './lock.js';
import { atomicWriteFileSync, recoverAtomicFile } from './atomic-file.js';
import { acquireSharedLock, releaseSharedLock } from './lock.js';

export interface ArtifactGraphState {
  readonly artifacts: readonly Artifact[];
  readonly revisions: readonly Revision[];
  readonly transactions: readonly Transaction[];
}

export class ArtifactStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'io' | 'invalid' | 'conflict' | 'not-found' | 'validation',
  ) {
    super(message);
    this.name = 'ArtifactStoreError';
  }
}

/** Persistent Node-side Artifact Graph store. All writes replace one complete
 * validated JSON state file; compareAndSwap prevents stale AI edits from
 * overwriting a newer artifact head. */
export class FileSystemArtifactStore {
  private readonly rootDir: string;
  private readonly statePath: string;
  private readonly snapshotPath: string;
  private readonly mutexPath: string;
  private readonly mutexStaleMs: number;
  private readonly lockRetryBudgetMs: number;
  private readonly now: () => string;
  private readonly validateOperation?: (operation: TypedOperation) => readonly string[];

  constructor(options: {
    readonly rootDir: string;
    readonly stateName?: string;
    readonly snapshotName?: string;
    readonly mutexStaleMs?: number;
    readonly lockRetryBudgetMs?: number;
    readonly now?: () => string;
    readonly validateOperation?: (operation: TypedOperation) => readonly string[];
  }) {
    this.rootDir = resolve(options.rootDir);
    this.statePath = join(this.rootDir, options.stateName ?? 'artifact-graph.json');
    this.snapshotPath = join(this.rootDir, options.snapshotName ?? 'artifact-graph.snapshot.json');
    this.mutexPath = join(this.rootDir, `${options.stateName ?? 'artifact-graph.json'}.mutex`);
    this.mutexStaleMs = options.mutexStaleMs ?? 30 * 60 * 1000;
    this.lockRetryBudgetMs = options.lockRetryBudgetMs ?? 250;
    if (!Number.isSafeInteger(this.mutexStaleMs) || this.mutexStaleMs < 1_000)
      throw new ArtifactStoreError('mutexStaleMs must be at least one second', 'invalid');
    this.now = options.now ?? (() => new Date().toISOString());
    this.validateOperation = options.validateOperation;
    // Recover both durable state files as soon as a store instance opens. A
    // crash can leave either replacement in its fallback `.bak` phase; waiting
    // for an explicit read/snapshot call would expose a transient empty store.
    recoverAtomicFile(this.statePath);
    recoverAtomicFile(this.snapshotPath);
  }

  read(): ArtifactGraphState {
    recoverAtomicFile(this.statePath);
    if (!existsSync(this.statePath)) return { artifacts: [], revisions: [], transactions: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
    } catch {
      throw new ArtifactStoreError('artifact graph state is not valid JSON', 'invalid');
    }
    return validateState(parsed);
  }

  /** Canonical optimistic-concurrency token for callers coordinating writes
   * across processes. An empty store has the empty token. */
  version(): string {
    return this.versionOf(this.read());
  }

  write(state: ArtifactGraphState, expectedVersion?: string): void {
    const validated = validateState(state);
    mkdirSync(this.rootDir, { recursive: true });
    const token = acquireSharedLock(this.mutexPath, {
      staleMs: this.mutexStaleMs,
      retryBudgetMs: this.lockRetryBudgetMs,
    });
    if (token === null)
      throw new ArtifactStoreError(
        'artifact graph is being written by another process',
        'conflict',
      );
    try {
      const currentVersion = existsSync(this.statePath) ? canonicalize(this.read()) : '';
      if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        throw new ArtifactStoreError('artifact graph changed concurrently', 'conflict');
      }
      atomicWriteFileSync(this.statePath, `${JSON.stringify(validated, null, 2)}\n`);
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError('cannot atomically write artifact graph', 'io');
    } finally {
      releaseSharedLock(this.mutexPath, token);
    }
  }

  snapshot(): void {
    const token = acquireSharedLock(this.mutexPath, {
      staleMs: this.mutexStaleMs,
      retryBudgetMs: this.lockRetryBudgetMs,
    });
    if (token === null)
      throw new ArtifactStoreError(
        'artifact graph is being written by another process',
        'conflict',
      );
    try {
      const state = this.read();
      atomicWriteFileSync(this.snapshotPath, `${JSON.stringify(validateState(state), null, 2)}\n`);
    } finally {
      releaseSharedLock(this.mutexPath, token);
    }
  }

  rollback(): ArtifactGraphState {
    if (!existsSync(this.snapshotPath))
      throw new ArtifactStoreError('artifact graph snapshot not found', 'not-found');
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.snapshotPath, 'utf8'));
    } catch {
      throw new ArtifactStoreError('artifact graph snapshot is not valid JSON', 'invalid');
    }
    const state = validateState(parsed);
    const currentState = this.read();
    this.write(state, this.versionOf(currentState));
    return state;
  }

  createArtifact(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly projectId?: string;
    readonly createdBy: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }): Artifact {
    const state = this.read();
    if (state.artifacts.some((artifact) => artifact.id === input.id)) {
      throw new ArtifactStoreError(`artifact '${input.id}' already exists`, 'conflict');
    }
    const artifact: Artifact = {
      schema: 'logicpilot.artifact/v1',
      contractVersion: 1,
      id: input.id,
      kind: input.kind,
      createdAt: this.now(),
      createdBy: input.createdBy,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    const checked = validateContract('Artifact', artifact);
    if (!checked.ok) throw new ArtifactStoreError(checked.errors.join('; '), 'invalid');
    this.write({ ...state, artifacts: [...state.artifacts, checked.value] }, this.versionOf(state));
    return checked.value;
  }

  artifact(id: string): Artifact {
    const artifact = this.read().artifacts.find((candidate) => candidate.id === id);
    if (!artifact) throw new ArtifactStoreError(`artifact '${id}' was not found`, 'not-found');
    return artifact;
  }

  head(artifactId: string): Revision | undefined {
    this.artifact(artifactId);
    return this.read()
      .revisions.filter((revision) => revision.artifactId === artifactId)
      .at(-1);
  }

  propose(input: {
    readonly id: string;
    readonly idempotencyKey?: string;
    readonly proposedBy: string;
    readonly artifactRefs: readonly ArtifactRef[];
    readonly operations: readonly TypedOperation[];
  }): Transaction {
    const state = this.read();
    if (input.artifactRefs.length === 0) {
      throw new ArtifactStoreError('transaction needs an artifact reference', 'invalid');
    }
    for (const ref of input.artifactRefs) {
      if (!state.artifacts.some((artifact) => artifact.id === ref.artifactId)) {
        throw new ArtifactStoreError(`artifact '${ref.artifactId}' was not found`, 'not-found');
      }
    }
    if (input.idempotencyKey !== undefined) {
      const existing = state.transactions.find(
        (transaction) => transaction.idempotencyKey === input.idempotencyKey,
      );
      if (existing !== undefined) {
        const samePayload =
          existing.proposedBy === input.proposedBy &&
          canonicalize(existing.artifactRefs) === canonicalize(input.artifactRefs) &&
          canonicalize(existing.operations) === canonicalize(input.operations);
        if (!samePayload)
          throw new ArtifactStoreError(
            `idempotency key '${input.idempotencyKey}' was reused with a different transaction`,
            'conflict',
          );
        return existing;
      }
    }
    if (state.transactions.some((transaction) => transaction.id === input.id)) {
      throw new ArtifactStoreError(`transaction '${input.id}' already exists`, 'conflict');
    }
    const transaction: Transaction = {
      schema: 'logicpilot.transaction/v1',
      contractVersion: 1,
      id: input.id,
      status: 'proposed',
      proposedBy: input.proposedBy,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      artifactRefs: input.artifactRefs,
      operations: input.operations,
      createdAt: this.now(),
    };
    const checked = validateContract('Transaction', transaction);
    if (!checked.ok) throw new ArtifactStoreError(checked.errors.join('; '), 'invalid');
    this.write(
      { ...state, transactions: [...state.transactions, checked.value] },
      this.versionOf(state),
    );
    return checked.value;
  }

  transaction(id: string): Transaction {
    const transaction = this.read().transactions.find((candidate) => candidate.id === id);
    if (!transaction)
      throw new ArtifactStoreError(`transaction '${id}' was not found`, 'not-found');
    return transaction;
  }

  validate(transactionId: string): Transaction {
    const state = this.read();
    const transaction = state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction)
      throw new ArtifactStoreError(`transaction '${transactionId}' was not found`, 'not-found');
    if (transaction.status === 'committed' || transaction.status === 'awaiting-approval')
      return transaction;
    const errors = transaction.operations.flatMap(
      (operation) => this.validateOperation?.(operation) ?? [],
    );
    const next: Transaction = {
      ...transaction,
      status: errors.length === 0 ? 'validated' : 'rejected',
    };
    this.write(
      {
        ...state,
        transactions: state.transactions.map((candidate) =>
          candidate.id === transactionId ? next : candidate,
        ),
      },
      this.versionOf(state),
    );
    if (errors.length > 0) throw new ArtifactStoreError(errors.join('; '), 'validation');
    return next;
  }

  approve(transactionId: string, approvedBy: string): Transaction {
    const state = this.read();
    const transaction = state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction)
      throw new ArtifactStoreError(`transaction '${transactionId}' was not found`, 'not-found');
    if (transaction.status === 'committed') return transaction;
    if (transaction.status !== 'validated' && transaction.status !== 'awaiting-approval') {
      throw new ArtifactStoreError(`transaction '${transactionId}' is not validated`, 'validation');
    }
    const next: Transaction = { ...transaction, status: 'awaiting-approval', approvedBy };
    this.write(
      {
        ...state,
        transactions: state.transactions.map((candidate) =>
          candidate.id === transactionId ? next : candidate,
        ),
      },
      this.versionOf(state),
    );
    return next;
  }

  rollbackTransaction(
    transactionId: string,
    resolutionRecord = 'artifact-graph.rollback',
  ): Transaction {
    const state = this.read();
    const transaction = state.transactions.find((candidate) => candidate.id === transactionId);
    if (!transaction)
      throw new ArtifactStoreError(`transaction '${transactionId}' was not found`, 'not-found');
    if (transaction.status === 'committed') {
      throw new ArtifactStoreError('committed transactions cannot be rolled back', 'validation');
    }
    const next: Transaction = {
      ...transaction,
      status: 'rolled-back',
      resolutionRecord,
    };
    this.write(
      {
        ...state,
        transactions: state.transactions.map((candidate) =>
          candidate.id === transactionId ? next : candidate,
        ),
      },
      this.versionOf(state),
    );
    return next;
  }

  commit(input: {
    readonly transactionId: string;
    readonly revisionId: string;
    readonly artifactId: string;
    readonly createdBy: string;
    readonly digest: string;
  }): Revision {
    const state = this.read();
    const transaction = state.transactions.find(
      (candidate) => candidate.id === input.transactionId,
    );
    if (!transaction)
      throw new ArtifactStoreError(
        `transaction '${input.transactionId}' was not found`,
        'not-found',
      );
    if (transaction.status === 'committed') {
      const existing = state.revisions.find(
        (revision) => revision.id === transaction.committedRevisionId,
      );
      if (!existing)
        throw new ArtifactStoreError('committed transaction is missing its revision', 'invalid');
      if (existing.artifactId !== input.artifactId || existing.digest !== input.digest)
        throw new ArtifactStoreError('idempotent commit payload does not match', 'conflict');
      return existing;
    }
    if (transaction.status !== 'awaiting-approval') {
      throw new ArtifactStoreError('transaction is not approved', 'validation');
    }
    const artifact = state.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact)
      throw new ArtifactStoreError(`artifact '${input.artifactId}' was not found`, 'not-found');
    const current = state.revisions
      .filter((revision) => revision.artifactId === artifact.id)
      .at(-1);
    const expected = transaction.artifactRefs.find(
      (ref) => ref.artifactId === artifact.id,
    )?.revisionId;
    if ((current?.id ?? undefined) !== expected) {
      throw new ArtifactStoreError('artifact head changed since proposal', 'conflict');
    }
    if (state.revisions.some((revision) => revision.id === input.revisionId)) {
      throw new ArtifactStoreError(`revision '${input.revisionId}' already exists`, 'conflict');
    }
    const revision: Revision = {
      schema: 'logicpilot.revision/v1',
      contractVersion: 1,
      id: input.revisionId,
      artifactId: artifact.id,
      ...(current === undefined ? {} : { parentRevisionId: current.id }),
      createdAt: this.now(),
      createdBy: input.createdBy,
      operations: transaction.operations,
      digest: input.digest,
    };
    const checked = validateContract('Revision', revision);
    if (!checked.ok) throw new ArtifactStoreError(checked.errors.join('; '), 'invalid');
    const committed: Transaction = {
      ...transaction,
      status: 'committed',
      committedRevisionId: revision.id,
    };
    this.write(
      {
        artifacts: state.artifacts,
        revisions: [...state.revisions, checked.value],
        transactions: state.transactions.map((candidate) =>
          candidate.id === transaction.id ? committed : candidate,
        ),
      },
      this.versionOf(state),
    );
    return checked.value;
  }

  compareAndSwap(input: {
    readonly artifactId: string;
    readonly expectedRevisionId?: string;
    readonly revision: Revision;
    readonly transaction: Transaction;
  }): ArtifactGraphState {
    const state = this.read();
    const artifact = state.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact)
      throw new ArtifactStoreError(`artifact '${input.artifactId}' was not found`, 'not-found');
    const current = state.revisions
      .filter((revision) => revision.artifactId === input.artifactId)
      .at(-1);
    if ((current?.id ?? undefined) !== input.expectedRevisionId) {
      throw new ArtifactStoreError('artifact head changed since proposal', 'conflict');
    }
    if (input.revision.artifactId !== input.artifactId) {
      throw new ArtifactStoreError('revision artifact id does not match CAS target', 'invalid');
    }
    const next: ArtifactGraphState = {
      artifacts: state.artifacts,
      revisions: [...state.revisions, input.revision],
      transactions: [
        ...state.transactions.filter((transaction) => transaction.id !== input.transaction.id),
        input.transaction,
      ],
    };
    this.write(next, this.versionOf(state));
    return next;
  }

  private versionOf(state: ArtifactGraphState): string {
    return existsSync(this.statePath) ? canonicalize(state) : '';
  }
}

function validateState(value: unknown): ArtifactGraphState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactStoreError('artifact graph state must be an object', 'invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.artifacts) ||
    !Array.isArray(record.revisions) ||
    !Array.isArray(record.transactions)
  ) {
    throw new ArtifactStoreError('artifact graph state has an invalid shape', 'invalid');
  }
  const artifacts: Artifact[] = [];
  for (const raw of record.artifacts) {
    const checked = validateContract('Artifact', raw);
    if (!checked.ok)
      throw new ArtifactStoreError(`invalid artifact: ${checked.errors.join('; ')}`, 'invalid');
    artifacts.push(checked.value);
  }
  const revisions: Revision[] = [];
  for (const raw of record.revisions) {
    const checked = validateContract('Revision', raw);
    if (!checked.ok)
      throw new ArtifactStoreError(`invalid revision: ${checked.errors.join('; ')}`, 'invalid');
    revisions.push(checked.value);
  }
  const transactions: Transaction[] = [];
  for (const raw of record.transactions) {
    const checked = validateContract('Transaction', raw);
    if (!checked.ok)
      throw new ArtifactStoreError(`invalid transaction: ${checked.errors.join('; ')}`, 'invalid');
    transactions.push(checked.value);
  }
  return { artifacts, revisions, transactions };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}
