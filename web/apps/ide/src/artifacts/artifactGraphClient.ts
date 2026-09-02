import type { ModelPatch } from '@logicpilot/editor';
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

/** Begin a server-side transaction for a model patch. In unit-test/SSR
 * environments there is no app server, so the local editor remains usable and
 * the returned transaction is explicitly disabled rather than silently
 * pretending it was persisted. */
export async function beginModelPatchTransaction(
  patch: ModelPatch,
  actor = 'agent',
): Promise<PendingArtifactTransaction> {
  if (typeof window === 'undefined') return { enabled: false };
  const config = await getAppConfig();
  if (!config) return { enabled: false };
  const headers = sessionHeaders(config);
  const graph = await call<ArtifactGraphView>(config.apiBase, headers);
  // A development server may intentionally run without a persistence root.
  // Keep the local editor usable, but make the absence explicit to callers.
  if (graph.configured === false) return { enabled: false };
  if (!graph.artifacts.some((artifact) => artifact.id === MODEL_ARTIFACT_ID)) {
    await call(config.apiBase, headers, {
      action: 'create-artifact',
      input: { id: MODEL_ARTIFACT_ID, kind: 'semantic-model', createdBy: actor },
    });
  }
  const head = graph.revisions
    .filter((revision) => revision.artifactId === MODEL_ARTIFACT_ID)
    .at(-1);
  const operation = { opId: randomId('op'), opType: 'model-patch', payload: patch };
  const transactionId = randomId('tx');
  await call(config.apiBase, headers, {
    action: 'propose',
    input: {
      id: transactionId,
      proposedBy: actor,
      artifactRefs: [{ artifactId: MODEL_ARTIFACT_ID, ...(head ? { revisionId: head.id } : {}) }],
      operations: [operation],
    },
  });
  await call(config.apiBase, headers, { action: 'validate', transactionId });
  return {
    enabled: true,
    transactionId,
    artifactId: MODEL_ARTIFACT_ID,
    digest: await sha256Hex({ artifactId: MODEL_ARTIFACT_ID, operations: [operation] }),
  };
}

/** Approve and commit a transaction after local application and compilation
 * have succeeded. If either phase fails, callers should invoke rollback. */
export async function commitModelPatchTransaction(
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

export async function rollbackModelPatchTransaction(
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

export { MODEL_ARTIFACT_ID, canonicalize, sha256Hex };
