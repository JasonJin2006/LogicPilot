import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { Artifact, Revision, Transaction } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface ArtifactGraphState {
  readonly artifacts: readonly Artifact[];
  readonly revisions: readonly Revision[];
  readonly transactions: readonly Transaction[];
}

export class ArtifactStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'io' | 'invalid' | 'conflict' | 'not-found',
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

  constructor(options: {
    readonly rootDir: string;
    readonly stateName?: string;
    readonly snapshotName?: string;
  }) {
    this.rootDir = resolve(options.rootDir);
    this.statePath = join(this.rootDir, options.stateName ?? 'artifact-graph.json');
    this.snapshotPath = join(this.rootDir, options.snapshotName ?? 'artifact-graph.snapshot.json');
  }

  read(): ArtifactGraphState {
    if (!existsSync(this.statePath)) return { artifacts: [], revisions: [], transactions: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
    } catch {
      throw new ArtifactStoreError('artifact graph state is not valid JSON', 'invalid');
    }
    return validateState(parsed);
  }

  write(state: ArtifactGraphState): void {
    const validated = validateState(state);
    mkdirSync(this.rootDir, { recursive: true });
    const temporary = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      try {
        renameSync(temporary, this.statePath);
      } catch {
        if (existsSync(this.statePath)) unlinkSync(this.statePath);
        renameSync(temporary, this.statePath);
      }
    } catch {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw new ArtifactStoreError('cannot atomically write artifact graph', 'io');
    }
  }

  snapshot(): void {
    const state = this.read();
    this.writeFile(this.snapshotPath, state);
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
    this.write(state);
    return state;
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
    this.write(next);
    return next;
  }

  private writeFile(path: string, state: ArtifactGraphState): void {
    mkdirSync(this.rootDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(validateState(state), null, 2)}\n`, 'utf8');
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
