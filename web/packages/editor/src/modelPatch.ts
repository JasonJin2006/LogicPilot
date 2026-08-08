import {
  addNode,
  connect,
  disconnect,
  moveNode,
  removeNode,
  removeParam,
  renameNode,
  setParam,
  type ModelDocument,
  type ModelNode,
} from './graph.js';

export const MODEL_PATCH_VERSION = 1 as const;

export type ModelTarget = string;
export type ModelValue = string | number | boolean;

export type ModelPatchOperation =
  | {
      op: 'add_block';
      kind: string;
      name: string;
      x?: number;
      y?: number;
      container?: string;
      library?: string;
      params?: Record<string, ModelValue>;
    }
  | {
      op: 'update_block';
      target: ModelTarget;
      name?: string;
      x?: number;
      y?: number;
      params?: Record<string, ModelValue>;
      removeParams?: string[];
    }
  | { op: 'remove_block'; target: ModelTarget }
  | {
      op: 'connect';
      from: ModelTarget;
      to: ModelTarget;
      fromPort?: string;
      toPort?: string;
    }
  | {
      op: 'disconnect';
      edge?: string;
      from?: ModelTarget;
      to?: ModelTarget;
      fromPort?: string;
      toPort?: string;
    }
  | { op: 'rename_model'; name: string };

export interface ModelPatch {
  version: typeof MODEL_PATCH_VERSION;
  operations: ModelPatchOperation[];
}

export interface ModelPatchDiagnostic {
  operation: number;
  code: string;
  message: string;
}

export interface ModelPatchResult {
  ok: boolean;
  document: ModelDocument;
  applied: number;
  diagnostics: ModelPatchDiagnostic[];
}

function resolve(document: ModelDocument, target: string): ModelNode | string {
  const byId = document.nodes.find((node) => node.id === target);
  if (byId) return byId;
  const byName = document.nodes.filter((node) => node.name === target);
  if (byName.length === 1) return byName[0]!;
  if (byName.length === 0) return `unknown block '${target}'`;
  return `block name '${target}' is ambiguous; use its id`;
}

function diagnostic(operation: number, code: string, message: string): ModelPatchDiagnostic {
  return { operation, code, message };
}

/**
 * Atomically apply an AI/editor model patch. References accept either stable
 * node ids or unique block names. On any invalid operation the original
 * document is returned unchanged, which makes generated patches safe to
 * preview before committing them to undo history.
 */
export function applyModelPatch(document: ModelDocument, patch: ModelPatch): ModelPatchResult {
  if (patch.version !== MODEL_PATCH_VERSION || !Array.isArray(patch.operations)) {
    return {
      ok: false,
      document,
      applied: 0,
      diagnostics: [diagnostic(-1, 'MP0001', 'unsupported or malformed ModelPatch')],
    };
  }

  let next = document;
  for (let index = 0; index < patch.operations.length; ++index) {
    const operation = patch.operations[index]!;
    if (operation.op === 'rename_model') {
      if (!operation.name.trim()) {
        return failure(index, 'MP1001', 'model name must not be empty');
      }
      next = { ...next, name: operation.name.trim() };
      continue;
    }

    if (operation.op === 'add_block') {
      if (!operation.kind.trim() || !operation.name.trim()) {
        return failure(index, 'MP1002', 'block kind and name are required');
      }
      if (
        next.nodes.some(
          (node) => node.name === operation.name && node.container === operation.container,
        )
      ) {
        return failure(index, 'MP1003', `block '${operation.name}' already exists`);
      }
      const processNodes = next.nodes.filter((node) => (node.library ?? 'process') === 'process');
      const defaultX =
        processNodes.length === 0 ? 80 : Math.max(...processNodes.map((n) => n.x)) + 160;
      next = addNode(next, {
        kind: operation.kind,
        name: operation.name,
        x: operation.x ?? defaultX,
        y: operation.y ?? 120,
        params: operation.params,
        container: operation.container,
        library: operation.library ?? 'process',
      });
      continue;
    }

    if (operation.op === 'disconnect') {
      const matches = next.edges.filter((edge) => {
        if (operation.edge) return edge.id === operation.edge;
        const from = operation.from ? resolve(next, operation.from) : undefined;
        const to = operation.to ? resolve(next, operation.to) : undefined;
        if (typeof from === 'string' || typeof to === 'string') return false;
        return (
          (from === undefined || edge.from === from.id) &&
          (to === undefined || edge.to === to.id) &&
          (operation.fromPort === undefined || (edge.fromPort ?? 'out') === operation.fromPort) &&
          (operation.toPort === undefined || (edge.toPort ?? 'in') === operation.toPort)
        );
      });
      if (matches.length === 0) {
        return failure(index, 'MP2004', 'disconnect did not match an edge');
      }
      for (const edge of matches) next = disconnect(next, edge.id);
      continue;
    }

    if (operation.op === 'connect') {
      const from = resolve(next, operation.from);
      const to = resolve(next, operation.to);
      if (typeof from === 'string') return failure(index, 'MP2001', from);
      if (typeof to === 'string') return failure(index, 'MP2001', to);
      const connected = connect(next, from.id, to.id, operation.fromPort, operation.toPort);
      if (connected.error) return failure(index, 'MP2002', connected.error);
      next = connected.document;
      continue;
    }

    const target = resolve(next, operation.target);
    if (typeof target === 'string') return failure(index, 'MP2001', target);
    if (operation.op === 'remove_block') {
      next = removeNode(next, target.id);
      continue;
    }
    if (operation.op === 'update_block') {
      if (operation.name !== undefined) {
        const clean = operation.name.trim();
        if (!clean) return failure(index, 'MP1002', 'block name must not be empty');
        if (next.nodes.some((node) => node.id !== target.id && node.name === clean)) {
          return failure(index, 'MP1003', `block '${clean}' already exists`);
        }
        next = renameNode(next, target.id, clean);
      }
      if (operation.x !== undefined || operation.y !== undefined) {
        next = moveNode(next, target.id, operation.x ?? target.x, operation.y ?? target.y);
      }
      for (const key of operation.removeParams ?? []) next = removeParam(next, target.id, key);
      for (const [key, value] of Object.entries(operation.params ?? {})) {
        next = setParam(next, target.id, key, value);
      }
    }
  }

  return { ok: true, document: next, applied: patch.operations.length, diagnostics: [] };

  function failure(operation: number, code: string, message: string): ModelPatchResult {
    return { ok: false, document, applied: 0, diagnostics: [diagnostic(operation, code, message)] };
  }
}

/** Build an incremental patch that makes `current` structurally match
 * `desired`. Matching blocks keep their ids and canvas positions when kind
 * and container are unchanged, so AI regeneration does not destroy editor
 * identity or layout unnecessarily. */
export function diffModelDocuments(current: ModelDocument, desired: ModelDocument): ModelPatch {
  const operations: ModelPatchOperation[] = [];
  if (current.name !== desired.name) operations.push({ op: 'rename_model', name: desired.name });

  const desiredByName = new Map(desired.nodes.map((node) => [node.name, node]));
  const currentByName = new Map(current.nodes.map((node) => [node.name, node]));
  const stableNames = new Set(
    current.nodes
      .filter((node) => {
        const target = desiredByName.get(node.name);
        return target?.kind === node.kind && target.container === node.container;
      })
      .map((node) => node.name),
  );
  const currentNames = new Map(current.nodes.map((node) => [node.id, node.name]));
  const desiredNames = new Map(desired.nodes.map((node) => [node.id, node.name]));
  const edgeKey = (from: string, to: string, fromPort?: string, toPort?: string): string =>
    `${from}\u0000${fromPort ?? 'out'}\u0000${to}\u0000${toPort ?? 'in'}`;
  const desiredEdgeKeys = new Set(
    desired.edges.flatMap((edge) => {
      const from = desiredNames.get(edge.from);
      const to = desiredNames.get(edge.to);
      return from && to ? [edgeKey(from, to, edge.fromPort, edge.toPort)] : [];
    }),
  );
  const preservedEdgeKeys = new Set<string>();
  for (const edge of current.edges) {
    const from = currentNames.get(edge.from);
    const to = currentNames.get(edge.to);
    const key = from && to ? edgeKey(from, to, edge.fromPort, edge.toPort) : '';
    if (from && to && stableNames.has(from) && stableNames.has(to) && desiredEdgeKeys.has(key)) {
      preservedEdgeKeys.add(key);
    } else {
      operations.push({ op: 'disconnect', edge: edge.id });
    }
  }

  for (const node of current.nodes) {
    const target = desiredByName.get(node.name);
    if (!target || target.kind !== node.kind || target.container !== node.container) {
      operations.push({ op: 'remove_block', target: node.id });
    }
  }

  for (const node of desired.nodes) {
    const existing = currentByName.get(node.name);
    if (!existing || existing.kind !== node.kind || existing.container !== node.container) {
      operations.push({
        op: 'add_block',
        kind: node.kind,
        name: node.name,
        x: node.x,
        y: node.y,
        container: node.container,
        library: node.library,
        params: node.params,
      });
      continue;
    }
    const removeParams = Object.keys(existing.params).filter((key) => !(key in node.params));
    const params = Object.fromEntries(
      Object.entries(node.params).filter(([key, value]) => existing.params[key] !== value),
    );
    if (removeParams.length > 0 || Object.keys(params).length > 0) {
      operations.push({
        op: 'update_block',
        target: existing.id,
        params,
        removeParams,
      });
    }
  }

  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node.name]));
  for (const edge of desired.edges) {
    const from = desiredNodes.get(edge.from);
    const to = desiredNodes.get(edge.to);
    if (!from || !to) continue;
    const key = edgeKey(from, to, edge.fromPort, edge.toPort);
    if (preservedEdgeKeys.has(key)) continue;
    operations.push({
      op: 'connect',
      from,
      to,
      fromPort: edge.fromPort,
      toPort: edge.toPort,
    });
  }
  return { version: MODEL_PATCH_VERSION, operations };
}
