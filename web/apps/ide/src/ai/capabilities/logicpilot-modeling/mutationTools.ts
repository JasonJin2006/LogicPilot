// Structured model mutation tool owned by the LogicPilot capability.

import {
  applyModelPatch,
  generateDsl,
  MODEL_PATCH_VERSION,
  type ModelDocument,
  type ModelPatch,
  type ModelPatchOperation,
} from '@logicpilot/editor';
import type { AssistantTool } from '../../toolTypes';
import type { AssistantSessionState } from '../../assistantTypes';
import { summarizeModel } from '../../contextBuilder';
import { saveProject } from '../../../project/syncEngine';
import { BLOCK_DEFS, blockPorts, isExecutableProcessKind } from '../../../plugins/builtin/modeling';
import { useModelStore } from '../../../state/modelStore';
import { useProjectStore } from '../../../state/projectStore';
import { useWorkspaceStore } from '../../../state/workspaceStore';
import { compileCurrent } from './compile';
import {
  beginModelPatchTransaction,
  commitModelPatchTransaction,
  rollbackModelPatchTransaction,
} from '../../../artifacts/artifactGraphClient';

function stringArg(args: Record<string, unknown>, key: string): string | null {
  return typeof args[key] === 'string' ? (args[key] as string) : null;
}

function validateParamValues(params: Record<string, unknown> | undefined): string | null {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'number' && !Number.isFinite(value))
      return `param '${key}' must be a finite number`;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      return `param '${key}' must be a string, number or boolean`;
  }
  return null;
}

const KNOWN_KINDS = new Set(BLOCK_DEFS.map((block) => block.kind));

function validateOperation(operation: ModelPatchOperation): string | null {
  switch (operation.op) {
    case 'rename_model':
      return typeof operation.name === 'string' && operation.name.trim() !== ''
        ? null
        : 'rename_model.name must be a non-empty string';
    case 'add_block':
      if (typeof operation.kind !== 'string' || !KNOWN_KINDS.has(operation.kind))
        return `add_block.kind '${operation.kind}' is not a known block type`;
      if (operation.library === 'process' && !isExecutableProcessKind(operation.kind))
        return `add_block.kind '${operation.kind}' is not executable in the process library`;
      if (typeof operation.name !== 'string' || operation.name.trim() === '')
        return 'add_block.name must be a non-empty string';
      return validateParamValues(operation.params);
    case 'update_block':
      if (typeof operation.target !== 'string' || operation.target.trim() === '')
        return 'update_block.target must be a non-empty string';
      return validateParamValues(operation.params);
    case 'remove_block':
      return typeof operation.target === 'string' && operation.target.trim() !== ''
        ? null
        : 'remove_block.target must be a non-empty string';
    case 'connect':
      return typeof operation.from === 'string' && typeof operation.to === 'string'
        ? null
        : 'connect.from and connect.to must be strings';
    case 'disconnect':
      return null;
    default:
      return `unknown operation '${(operation as { op: string }).op}'`;
  }
}

export function previewModelPatch(patch: unknown): {
  ok: boolean;
  error?: string;
  preview?: ModelPatch;
  candidate?: ModelDocument;
} {
  if (
    patch === null ||
    typeof patch !== 'object' ||
    (patch as { version?: unknown }).version !== MODEL_PATCH_VERSION ||
    !Array.isArray((patch as { operations?: unknown }).operations)
  )
    return { ok: false, error: 'patch must be {version:1, operations:[...]}' };
  const operations = (patch as { operations: ModelPatchOperation[] }).operations;
  if (operations.length === 0) return { ok: false, error: 'patch has no operations' };
  for (const operation of operations) {
    const problem = validateOperation(operation);
    if (problem) return { ok: false, error: problem };
  }
  const preview = applyModelPatch(useModelStore.getState().document, {
    version: MODEL_PATCH_VERSION,
    operations,
  });
  if (!preview.ok)
    return { ok: false, error: preview.diagnostics.map((entry) => entry.message).join('; ') };
  return {
    ok: true,
    preview: { version: MODEL_PATCH_VERSION, operations },
    candidate: preview.document,
  };
}

function danglingEdgeCount(document: ModelDocument, nodeId: string): number {
  return document.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}

export const MODEL_MUTATION_TOOLS: readonly AssistantTool[] = [
  {
    name: 'apply_model_patch',
    description: 'Apply a structured model patch as one atomic, undoable edit, then compile.',
    parameters: {
      patch: { type: 'object', required: true },
      summary: { type: 'string', required: true },
    },
    validate: (args) => {
      if (stringArg(args, 'summary') === null) return 'apply_model_patch.summary must be a string';
      const checked = previewModelPatch(args.patch);
      return checked.ok ? null : (checked.error ?? 'invalid patch');
    },
    execute: async (args, { session, signal }) => {
      // The canvas document is session-only. Mutating it without an open
      // workspace creates the misleading impression that the request was
      // persisted, while there is nowhere to save it. A plain folder is a
      // valid workspace even before it contains logicpilot.json.
      if (!useWorkspaceStore.getState().isOpen()) {
        return {
          ok: false,
          error:
            'No workspace is open. You can keep chatting, but creating or modifying models requires an open workspace.',
        };
      }
      const summary = stringArg(args, 'summary') ?? '';
      const checked = previewModelPatch(args.patch);
      if (!checked.ok) return { ok: false, error: checked.error ?? 'invalid patch' };
      const patch = checked.preview!;
      const candidate = checked.candidate!;
      const store = useModelStore.getState();
      if (session.documentSnapshot !== null && store.document !== session.documentSnapshot)
        return {
          ok: false,
          error: 'the model changed during the AI request; review the manual edit before retrying',
        };
      const before = store.document;
      const projectState = useProjectStore.getState();
      const synced = saveProject(candidate, projectState.bundle);
      const syncErrors = synced.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (syncErrors.length > 0) {
        return {
          ok: false,
          error: `model change could not be synchronized to project files: ${syncErrors
            .map((diagnostic) => diagnostic.message)
            .join('; ')}`,
        };
      }
      let pendingArtifactTransaction;
      try {
        pendingArtifactTransaction = await beginModelPatchTransaction(patch);
      } catch (error) {
        return {
          ok: false,
          error: `artifact transaction could not be prepared: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      const result = store.applyPatch(patch);
      if (!result.ok) {
        await rollbackModelPatchTransaction(pendingArtifactTransaction, 'local-apply-failed').catch(
          () => undefined,
        );
        return { ok: false, error: result.diagnostics.map((entry) => entry.message).join('; ') };
      }
      const after = useModelStore.getState().document;
      let compiled;
      try {
        compiled = await compileCurrent(session, signal);
        const revisionId = await commitModelPatchTransaction(pendingArtifactTransaction);
        if (revisionId !== undefined) session.lastArtifactRevisionId = revisionId;
      } catch (error) {
        await rollbackModelPatchTransaction(
          pendingArtifactTransaction,
          'local-compile-or-commit-failed',
        ).catch(() => undefined);
        store.undo();
        session.dsl = generateDsl(before);
        session.documentSnapshot = before;
        throw error;
      }
      // Compiler diagnostics are model feedback, not a transport failure:
      // keep the validated edit committed so the Agent can repair it in the
      // next step. Exceptions/abort during compilation still roll back above.
      projectState.openBundle(synced.bundle);
      projectState.markDirty();
      if (projectState.diskFiles !== null) {
        projectState.setDiskFiles(
          [
            ...new Set([
              ...projectState.diskFiles,
              'logicpilot.json',
              ...Object.keys(synced.files),
            ]),
          ].sort(),
        );
      }
      const removedEdges = before.edges.filter(
        (edge) => !after.edges.some((entry) => entry.id === edge.id),
      ).length;
      session.documentSnapshot = after;
      session.lastPatch =
        session.lastPatch === null
          ? patch
          : {
              version: MODEL_PATCH_VERSION,
              operations: [...session.lastPatch.operations, ...patch.operations],
            };
      session.lastChangeSummary = [session.lastChangeSummary, summary].filter(Boolean).join('; ');
      session.runStatus = 'none';
      session.runMetrics = null;
      session.previousRunMetrics = null;
      session.runSummary = '';
      return {
        ok: true,
        applied: result.applied,
        summary,
        removedEdges,
        compiled,
        model: summarizeModel(after),
      };
    },
  },
];

export { blockPorts, danglingEdgeCount };
export type { AssistantSessionState };
