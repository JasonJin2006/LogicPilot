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
  const operation = {
    opId: randomId('op'),
    opType: input.operationType,
    payload: input.payload,
  };
  const transactionId = randomId('tx');
  await call(config.apiBase, headers, {
    action: 'propose',
    input: {
      id: transactionId,
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
  const pending = await beginArtifactTransaction({
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
  try {
    return await commitArtifactTransaction(pending, 'runtime');
  } catch (error) {
    await rollbackArtifactTransaction(pending, 'evidence-commit-failed').catch(() => undefined);
    throw error;
  }
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

export { MODEL_ARTIFACT_ID, canonicalize, sha256Hex };
