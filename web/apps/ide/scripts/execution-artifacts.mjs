import { createHash } from 'node:crypto';
import {
  FileSystemArtifactStore,
  FileSystemArtifactOutbox,
} from '../../../packages/plugin-catalog/dist/index.bundle.js';
import { applyModelPatch, generateDsl } from '../../../packages/editor/dist/editor.bundle.js';
import { drainArtifactOutbox } from './plugin-catalog-bridge.mjs';

const error = (status, message) => Object.assign(new Error(message), { status });

export function materializeExecutionSource(ref) {
  if (ref === undefined) return undefined;
  const root = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  if (!root) throw error(503, 'artifact graph is required for pinned execution');
  if (!ref.revisionId) throw error(400, 'execution requires an explicit artifact revision');
  const state = new FileSystemArtifactStore({ rootDir: root }).read();
  const artifact = state.artifacts.find((item) => item.id === ref.artifactId);
  if (!artifact) throw error(404, 'execution artifact was not found');
  if (artifact.kind !== 'semantic-model') throw error(409, 'artifact is not an executable model');
  const revision = state.revisions.find(
    (item) => item.artifactId === ref.artifactId && item.id === ref.revisionId,
  );
  if (!revision) throw error(404, 'execution revision was not found');
  const save = [...revision.operations].reverse().find((item) => item.opType === 'model-save');
  if (typeof save?.payload?.dsl === 'string') return save.payload.dsl;
  // Patch-only revision: replay the model-patch chain on top of the nearest
  // model-save snapshot that still carries the canonical document.
  const byId = new Map(state.revisions.map((item) => [item.id, item]));
  const patches = [];
  let cursor = revision;
  let base = null;
  let guarded = 0;
  while (cursor && guarded++ <= state.revisions.length) {
    const operation = [...cursor.operations]
      .reverse()
      .find((item) => item.opType === 'model-save' || item.opType === 'model-patch');
    if (operation?.opType === 'model-save') {
      base = operation;
      break;
    }
    if (operation?.opType === 'model-patch') patches.push(operation);
    cursor = cursor.parentRevisionId ? byId.get(cursor.parentRevisionId) : null;
  }
  if (!base) throw error(409, 'execution revision has no executable snapshot; save the model again');
  const document = base.payload?.document;
  if (document === undefined || document === null || typeof document !== 'object')
    throw error(409, 'patch chain requires a model-save snapshot with the document; save again');
  let current = document;
  for (const operation of patches.reverse()) {
    const result = applyModelPatch(current, operation.payload);
    if (!result.ok) {
      const first = result.diagnostics?.[0];
      throw error(
        409,
        `patch chain failed: ${first ? `${first.code} ${first.message}` : 'malformed model patch'}`,
      );
    }
    current = result.document;
  }
  return generateDsl(current);
}

export async function persistExecutionResult(request, result) {
  const root = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  if (!root) return {}; // Unconfigured scratch executions are explicitly non-durable.
  const store = new FileSystemArtifactStore({ rootDir: root });
  const outbox = new FileSystemArtifactOutbox({ rootDir: root });
  const key = createHash('sha256')
    .update(`${request.targetId}\0${request.requestId}`)
    .digest('hex');
  const persist = async (suffix, kind, operationType, payload) => {
    const artifactId = `execution:${key}:${suffix}`;
    const normalized = JSON.parse(JSON.stringify(payload));
    const existing = store.read().revisions.find((revision) => revision.artifactId === artifactId);
    if (existing) {
      if (canonical(existing.operations[0]?.payload) !== canonical(normalized))
        throw error(409, 'execution request id was reused with a different result');
      return { artifactId, revisionId: existing.id };
    }
    const entry = outbox.enqueue({
      artifactId,
      artifactKind: kind,
      operationType,
      payload: normalized,
      actor: 'runtime',
    });
    await drainArtifactOutbox(store, outbox);
    const committed = outbox.list().find((item) => item.id === entry.id);
    if (!committed?.resultRevisionId)
      throw error(503, 'execution artifact is queued but not committed');
    return { artifactId, revisionId: committed.resultRevisionId };
  };
  const evidenceRef = result.evidence
    ? await persist('evidence', 'evidence', 'execution-evidence', {
        request,
        evidence: result.evidence,
      })
    : undefined;
  const run = { ...result.run, ...(evidenceRef ? { evidenceRef } : {}) };
  const runRef = await persist('run', 'run', 'simulation-run', { request, run });
  return { runRef, ...(evidenceRef ? { evidenceRef } : {}) };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
