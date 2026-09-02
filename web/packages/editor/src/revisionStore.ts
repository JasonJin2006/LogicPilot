import type {
  Artifact,
  ArtifactKind,
  ArtifactRef,
  Revision,
  Transaction,
  TypedOperation,
} from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface RevisionStoreOptions {
  readonly validateOperation?: (operation: TypedOperation) => readonly string[];
  readonly now?: () => string;
}

export class RevisionStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      'invalid-artifact' | 'invalid-transaction' | 'not-found' | 'conflict' | 'validation',
  ) {
    super(message);
    this.name = 'RevisionStoreError';
  }
}

/** In-memory reference implementation of the unified Artifact Graph protocol.
 * Persistence adapters can replace the maps without changing proposal,
 * validation or optimistic-commit semantics. */
export class RevisionStore {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly revisions = new Map<string, Revision[]>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly now: () => string;

  constructor(private readonly options: RevisionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createArtifact(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly projectId?: string;
    readonly createdBy: string;
    readonly metadata?: Readonly<Record<string, string>>;
  }): Artifact {
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
    const validated = validateContract('Artifact', artifact);
    if (!validated.ok)
      throw new RevisionStoreError(validated.errors.join('; '), 'invalid-artifact');
    if (this.artifacts.has(input.id))
      throw new RevisionStoreError(`artifact '${input.id}' already exists`, 'conflict');
    this.artifacts.set(input.id, validated.value);
    this.revisions.set(input.id, []);
    return validated.value;
  }

  artifact(id: string): Artifact {
    const value = this.artifacts.get(id);
    if (!value) throw new RevisionStoreError(`artifact '${id}' was not found`, 'not-found');
    return value;
  }

  head(artifactId: string): Revision | undefined {
    this.artifact(artifactId);
    return this.revisions.get(artifactId)?.at(-1);
  }

  propose(input: {
    readonly id: string;
    readonly proposedBy: string;
    readonly artifactRefs: readonly ArtifactRef[];
    readonly operations: readonly TypedOperation[];
  }): Transaction {
    if (input.artifactRefs.length === 0)
      throw new RevisionStoreError(
        'transaction needs an artifact reference',
        'invalid-transaction',
      );
    for (const ref of input.artifactRefs) this.artifact(ref.artifactId);
    const transaction: Transaction = {
      schema: 'logicpilot.transaction/v1',
      contractVersion: 1,
      id: input.id,
      status: 'proposed',
      proposedBy: input.proposedBy,
      artifactRefs: input.artifactRefs,
      operations: input.operations,
      createdAt: this.now(),
    };
    const validated = validateContract('Transaction', transaction);
    if (!validated.ok)
      throw new RevisionStoreError(validated.errors.join('; '), 'invalid-transaction');
    if (this.transactions.has(input.id))
      throw new RevisionStoreError(`transaction '${input.id}' already exists`, 'conflict');
    this.transactions.set(input.id, validated.value);
    return validated.value;
  }

  validate(transactionId: string): Transaction {
    const transaction = this.transaction(transactionId);
    const errors = transaction.operations.flatMap(
      (operation) => this.options.validateOperation?.(operation) ?? [],
    );
    const next: Transaction = {
      ...transaction,
      status: errors.length === 0 ? 'validated' : 'rejected',
    };
    this.transactions.set(transactionId, next);
    if (errors.length > 0) throw new RevisionStoreError(errors.join('; '), 'validation');
    return next;
  }

  approve(transactionId: string, approvedBy: string): Transaction {
    const transaction = this.transaction(transactionId);
    if (transaction.status !== 'validated' && transaction.status !== 'awaiting-approval') {
      throw new RevisionStoreError(`transaction '${transactionId}' is not validated`, 'validation');
    }
    const next: Transaction = { ...transaction, status: 'awaiting-approval', approvedBy };
    this.transactions.set(transactionId, next);
    return next;
  }

  commit(input: {
    readonly transactionId: string;
    readonly revisionId: string;
    readonly artifactId: string;
    readonly createdBy: string;
    readonly digest: string;
  }): Revision {
    const transaction = this.transaction(input.transactionId);
    if (transaction.status !== 'awaiting-approval')
      throw new RevisionStoreError('transaction is not approved', 'validation');
    const artifact = this.artifact(input.artifactId);
    const current = this.head(artifact.id);
    const expected = transaction.artifactRefs.find(
      (ref) => ref.artifactId === artifact.id,
    )?.revisionId;
    if ((current?.id ?? undefined) !== expected)
      throw new RevisionStoreError('artifact head changed since proposal', 'conflict');
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
    const validated = validateContract('Revision', revision);
    if (!validated.ok)
      throw new RevisionStoreError(validated.errors.join('; '), 'invalid-transaction');
    const history = this.revisions.get(artifact.id)!;
    if (history.some((candidate) => candidate.id === revision.id))
      throw new RevisionStoreError(`revision '${revision.id}' already exists`, 'conflict');
    history.push(validated.value);
    this.transactions.set(input.transactionId, {
      ...transaction,
      status: 'committed',
      committedRevisionId: revision.id,
    });
    return validated.value;
  }

  transaction(id: string): Transaction {
    const value = this.transactions.get(id);
    if (!value) throw new RevisionStoreError(`transaction '${id}' was not found`, 'not-found');
    return value;
  }
}
