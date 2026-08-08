import {
  applyModelPatch,
  diffModelDocuments,
  parseDsl,
  type ModelDocument,
  type ModelPatch,
  type ModelPatchOperation,
} from '@logicpilot/editor';

export interface ModelProposal {
  ok: boolean;
  baseDocument: ModelDocument;
  patch: ModelPatch | null;
  candidateDocument: ModelDocument | null;
  descriptions: string[];
  destructiveOperations: number;
  error?: string;
}

function describe(operation: ModelPatchOperation): string {
  switch (operation.op) {
    case 'rename_model':
      return `Rename model to ${operation.name}`;
    case 'add_block':
      return `Add ${operation.kind} ${operation.name}`;
    case 'update_block': {
      const changes = [
        ...Object.keys(operation.params ?? {}),
        ...(operation.removeParams ?? []).map((name) => `remove ${name}`),
      ];
      return `Update ${operation.target}${changes.length > 0 ? `: ${changes.join(', ')}` : ''}`;
    }
    case 'remove_block':
      return `Remove block ${operation.target}`;
    case 'connect':
      return `Connect ${operation.from}.${operation.fromPort ?? 'out'} → ${operation.to}.${operation.toPort ?? 'in'}`;
    case 'disconnect':
      return operation.edge
        ? `Disconnect edge ${operation.edge}`
        : `Disconnect ${operation.from ?? '*'} → ${operation.to ?? '*'}`;
  }
}

/** Convert an AI-produced, compiler-validated DSL candidate into the only
 * mutation protocol accepted by the editor. The caller previews this object;
 * no model state changes occur here. */
export function createModelProposal(current: ModelDocument, candidateDsl: string): ModelProposal {
  const parsed = parseDsl(candidateDsl);
  if (!parsed.ok) {
    return {
      ok: false,
      baseDocument: current,
      patch: null,
      candidateDocument: null,
      descriptions: [],
      destructiveOperations: 0,
      error: parsed.error ?? 'AI returned DSL that the editor cannot parse',
    };
  }
  const patch = diffModelDocuments(current, parsed.document);
  return createPatchProposal(current, patch);
}

/** Validate a native structured patch against the inspected document and
 * prepare the resulting candidate without mutating editor state. */
export function createPatchProposal(current: ModelDocument, patch: ModelPatch): ModelProposal {
  const applied = applyModelPatch(current, patch);
  if (!applied.ok) {
    return {
      ok: false,
      baseDocument: current,
      patch: null,
      candidateDocument: null,
      descriptions: [],
      destructiveOperations: 0,
      error: applied.diagnostics.map((entry) => entry.message).join('; '),
    };
  }
  const destructiveOperations = patch.operations.filter(
    (operation) => operation.op === 'remove_block' || operation.op === 'disconnect',
  ).length;
  return {
    ok: true,
    baseDocument: current,
    patch,
    candidateDocument: applied.document,
    descriptions: patch.operations.map(describe),
    destructiveOperations,
  };
}
