import type { ModelDocument, ModelEdge, ModelNode } from '@logicpilot/editor';
import { BLOCK_DEFAULTS, blockPorts, isExecutableProcessKind } from './blockDefs';

export type ModelDiagnosticSeverity = 'error' | 'warning';

export interface ModelDiagnostic {
  code: string;
  severity: ModelDiagnosticSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isProcessNode(node: ModelNode): boolean {
  return (
    node.library === 'process' || (node.library === undefined && isExecutableProcessKind(node.kind))
  );
}

function effectiveParams(node: ModelNode): Record<string, string | number | boolean> {
  return { ...(BLOCK_DEFAULTS[node.kind] ?? {}), ...node.params };
}

function enabled(value: string | number | boolean | undefined): boolean {
  return value === true || value === 1 || value === 'true';
}

function referenceName(value: string | number | boolean | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function numericValue(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function edgePort(edge: ModelEdge, side: 'from' | 'to'): string {
  return side === 'from' ? (edge.fromPort ?? 'out') : (edge.toPort ?? 'in');
}

/**
 * Fast, deterministic DES checks that can run on every editor change. This
 * does not replace the compiler: it catches graph and catalog errors before
 * a network compile and leaves expression/type analysis to the DSL service.
 */
export function validateDesModel(document: ModelDocument): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const processNodes = document.nodes.filter(isProcessNode);
  const processIds = new Set(processNodes.map((node) => node.id));

  if (processNodes.length === 0) return diagnostics;

  if (!IDENTIFIER.test(document.name)) {
    diagnostics.push({
      code: 'LP0001',
      severity: 'error',
      message: `model name '${document.name}' must be a valid identifier`,
    });
  }

  const names = new Map<string, ModelNode>();
  for (const node of processNodes) {
    if (!isExecutableProcessKind(node.kind)) {
      diagnostics.push({
        code: 'LP2004',
        severity: 'error',
        message: `block '${node.name}' has unsupported process kind '${node.kind}'`,
        nodeId: node.id,
      });
    }
    if (!IDENTIFIER.test(node.name)) {
      diagnostics.push({
        code: 'LP0001',
        severity: 'error',
        message: `block name '${node.name}' must be a valid identifier`,
        nodeId: node.id,
      });
    }
    const scopeKey = `${node.container ?? ''}\u0000${node.name}`;
    const previous = names.get(scopeKey);
    if (previous) {
      diagnostics.push({
        code: 'LP1002',
        severity: 'error',
        message: `duplicate block name '${node.name}' in the same scope`,
        nodeId: node.id,
      });
    } else {
      names.set(scopeKey, node);
    }
  }

  const usableEdges: ModelEdge[] = [];
  for (const edge of document.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      diagnostics.push({
        code: 'LP5002',
        severity: 'error',
        message: `connection '${edge.id}' references a missing block`,
        edgeId: edge.id,
      });
      continue;
    }
    if (!processIds.has(from.id) && !processIds.has(to.id)) continue;
    if (!processIds.has(from.id) || !processIds.has(to.id)) {
      diagnostics.push({
        code: 'LP5002',
        severity: 'error',
        message: `connection '${edge.id}' mixes process and non-process elements`,
        edgeId: edge.id,
      });
      continue;
    }
    if (from.container !== to.container) {
      diagnostics.push({
        code: 'LP5002',
        severity: 'error',
        message: `connection '${edge.id}' crosses model scopes`,
        edgeId: edge.id,
      });
      continue;
    }

    const fromPortName = edgePort(edge, 'from');
    const toPortName = edgePort(edge, 'to');
    const fromPort = blockPorts(from.kind).find((port) => port.name === fromPortName);
    const toPort = blockPorts(to.kind).find((port) => port.name === toPortName);
    if (!fromPort || (fromPort.direction !== 'out' && fromPort.direction !== 'inout')) {
      diagnostics.push({
        code: 'LP5003',
        severity: 'error',
        message: `'${from.name}.${fromPortName}' is not an output port`,
        edgeId: edge.id,
        nodeId: from.id,
      });
      continue;
    }
    if (!toPort || (toPort.direction !== 'in' && toPort.direction !== 'inout')) {
      diagnostics.push({
        code: 'LP5003',
        severity: 'error',
        message: `'${to.name}.${toPortName}' is not an input port`,
        edgeId: edge.id,
        nodeId: to.id,
      });
      continue;
    }
    if (fromPort.conditionalOn && !enabled(effectiveParams(from)[fromPort.conditionalOn])) {
      diagnostics.push({
        code: 'LP5003',
        severity: 'error',
        message: `'${from.name}.${fromPortName}' requires '${fromPort.conditionalOn}'`,
        edgeId: edge.id,
        nodeId: from.id,
      });
      continue;
    }
    if (toPort.conditionalOn && !enabled(effectiveParams(to)[toPort.conditionalOn])) {
      diagnostics.push({
        code: 'LP5003',
        severity: 'error',
        message: `'${to.name}.${toPortName}' requires '${toPort.conditionalOn}'`,
        edgeId: edge.id,
        nodeId: to.id,
      });
      continue;
    }
    usableEdges.push(edge);
  }

  const outgoingByPort = new Map<string, number>();
  for (const edge of usableEdges) {
    const key = `${edge.from}\u0000${edgePort(edge, 'from')}`;
    const count = (outgoingByPort.get(key) ?? 0) + 1;
    outgoingByPort.set(key, count);
    if (count === 2) {
      const from = byId.get(edge.from)!;
      diagnostics.push({
        code: 'LP5007',
        severity: 'error',
        message: `'${from.name}.${edgePort(edge, 'from')}' cannot fan out implicitly`,
        nodeId: from.id,
        edgeId: edge.id,
      });
    }
  }

  const scopes = new Map<string, ModelNode[]>();
  for (const node of processNodes.filter((candidate) => candidate.kind !== 'resource')) {
    const key = node.container ?? '';
    scopes.set(key, [...(scopes.get(key) ?? []), node]);
  }
  for (const [scope, nodes] of scopes) {
    if (!nodes.some((node) => node.kind === 'source' || node.kind === 'enter')) {
      diagnostics.push({
        code: 'LP2002',
        severity: 'error',
        message: `${scope ? `scope '${scope}'` : 'model'} has no source stage`,
      });
    }
  }

  const incoming = new Set(usableEdges.map((edge) => edge.to));
  const outgoing = new Set(usableEdges.map((edge) => edge.from));
  for (const node of processNodes) {
    const ports = blockPorts(node.kind);
    if (ports.some((port) => port.name === 'in') && !incoming.has(node.id)) {
      diagnostics.push({
        code: 'LP5004',
        severity: 'error',
        message: `'${node.name}.in' is not connected`,
        nodeId: node.id,
      });
    }
    if (ports.some((port) => port.name === 'out') && !outgoing.has(node.id)) {
      diagnostics.push({
        code: 'LPV1001',
        severity: 'warning',
        message: `'${node.name}.out' is not connected`,
        nodeId: node.id,
      });
    }

    const params = effectiveParams(node);
    validateMinimum(node, params, 'capacity', node.kind === 'queue' ? 0 : 1, diagnostics);
    if (node.kind === 'service' || node.kind === 'seize') {
      const resourceName = referenceName(params.resource);
      const resource = processNodes.find(
        (candidate) =>
          candidate.kind === 'resource' &&
          candidate.name === resourceName &&
          (candidate.container === node.container || candidate.container === undefined),
      );
      if (!resourceName || !resource) {
        diagnostics.push({
          code: 'LP2001',
          severity: 'error',
          message: `'${node.name}' must reference an existing resource block`,
          nodeId: node.id,
        });
      }
    }
    if (node.kind === 'service') {
      validateMinimum(node, params, 'numberOfUnits', 1, diagnostics);
      validateMinimum(node, params, 'queueCapacity', 0, diagnostics);
    }
    if (node.kind === 'source') {
      validateMinimum(node, params, 'agentsPerArrival', 1, diagnostics);
      validateMinimum(node, params, 'firstArrivalTime', 0, diagnostics);
    }
    if (enabled(params.enableTimeout)) {
      validateMinimum(node, params, 'timeout', Number.MIN_VALUE, diagnostics, true);
    }
  }

  return diagnostics;
}

function validateMinimum(
  node: ModelNode,
  params: Record<string, string | number | boolean>,
  field: string,
  minimum: number,
  diagnostics: ModelDiagnostic[],
  strictlyPositive = false,
): void {
  const value = numericValue(params[field]);
  if (value === null) return;
  if (Number.isNaN(value) || (strictlyPositive ? value <= 0 : value < minimum)) {
    diagnostics.push({
      code: 'LP3001',
      severity: 'error',
      message: `'${node.name}.${field}' must be ${strictlyPositive ? '> 0' : `>= ${minimum}`}`,
      nodeId: node.id,
    });
  }
}
