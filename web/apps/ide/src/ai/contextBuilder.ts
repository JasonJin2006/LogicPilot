// Assistant context assembly: turns live editor state into a bounded,
// JSON-serializable digest for the model. Never sends raw store objects or
// non-serializable values; every section is a compact string.

import type { ModelDocument } from '@logicpilot/editor';
import type { AssistantContext, AssistantSessionState } from './assistantTypes';
import type { AiMetrics } from './api';
import { PLUGIN_REGISTRY } from '../plugins/registry';
import { compilePluginContext } from './contextCompiler';

const MAX_NODES_IN_SUMMARY = 200;
const MAX_DSL_CHARS = 12000;

function paramText(params: Record<string, unknown> | undefined): string {
  const entries = Object.entries(params ?? {});
  if (entries.length === 0) {
    return '';
  }
  return ' ' + entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
}

/** Compact one-line-per-node model summary with ids, so follow-up requests
 *  can reference "那个队列" precisely (ids + unique names). */
export function summarizeModel(document: ModelDocument): {
  name: string;
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    container: string | null;
    params: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; from: string; to: string; fromPort?: string; toPort?: string }>;
} {
  return {
    name: document.name,
    nodes: document.nodes.slice(0, MAX_NODES_IN_SUMMARY).map((node) => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      container: node.container ?? null,
      params: node.params,
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      fromPort: edge.fromPort,
      toPort: edge.toPort,
    })),
  };
}

function renderSummary(document: ModelDocument): string {
  const summary = summarizeModel(document);
  const lines = [`model '${summary.name}'`, `nodes (${summary.nodes.length}):`];
  for (const node of summary.nodes) {
    lines.push(
      `- id=${node.id} kind=${node.kind} name='${node.name}'${node.container ? ` container=${node.container}` : ''}${paramText(node.params)}`,
    );
  }
  lines.push(`edges (${summary.edges.length}):`);
  for (const edge of summary.edges) {
    lines.push(
      `- ${edge.from}${edge.fromPort ? `.${edge.fromPort}` : '.out'} -> ${edge.to}${edge.toPort ? `.${edge.toPort}` : '.in'} (id=${edge.id})`,
    );
  }
  return lines.join('\n');
}

function renderSelection(document: ModelDocument, selectedId: string | null): string {
  if (selectedId === null) {
    return 'nothing selected';
  }
  const node = document.nodes.find((entry) => entry.id === selectedId);
  if (!node) {
    return 'selection no longer exists';
  }
  return `id=${node.id} kind=${node.kind} name='${node.name}'${paramText(node.params)}`;
}

function renderMetrics(metrics: AiMetrics): string {
  const lines: string[] = [];
  if (metrics.summary) {
    const pick = (key: string) => {
      const entry = metrics.summary![key];
      return entry ? `mean=${entry.mean.toFixed(4)}` : 'n/a';
    };
    lines.push(
      `throughput ${pick('throughput')}; W ${pick('W')}; Wq ${pick('Wq')}; L ${pick('L')}; Lq ${pick('Lq')}; utilization ${pick('utilization')}`,
    );
  }
  for (const block of metrics.blocks ?? []) {
    lines.push(
      `block ${block.kind} '${block.name}': arrived=${block.arrived_mean.toFixed(0)} departed=${block.departed_mean.toFixed(0)} util=${(block.utilization * 100).toFixed(1)}% occupancy=${block.mean_occupancy.toFixed(3)} stageWait=${block.mean_wait.toFixed(3)} timeouts=${block.timed_out_mean.toFixed(0)}`,
    );
  }
  return lines.join('\n');
}

function renderDiagnostics(diagnostics: Array<{ code: string; message: string }>): string {
  if (diagnostics.length === 0) {
    return 'no diagnostics (last compile passed)';
  }
  return diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('\n');
}

export interface ContextInput {
  projectName: string;
  workspaceRoot?: string;
  document: ModelDocument;
  selectedId: string | null;
  session: AssistantSessionState;
  documentType?: string | null;
  paradigm?: string | null;
  domain?: string | null;
}

/** Build the bounded context snapshot for the next reasoning step. */
export function buildAssistantContext(input: ContextInput): AssistantContext {
  const { document, selectedId, session } = input;
  const dsl = session.dsl && document === session.documentSnapshot ? session.dsl : '';
  const compiled = compilePluginContext(PLUGIN_REGISTRY.snapshot(), {
    documentType: input.documentType,
    paradigm: input.paradigm,
    domain: input.domain,
  });
  return {
    project: input.projectName,
    ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot }),
    modelSummary: renderSummary(document),
    selection: renderSelection(document, selectedId),
    dsl: dsl.slice(0, MAX_DSL_CHARS),
    diagnostics: renderDiagnostics(session.diagnostics),
    ...(compiled.knowledge === undefined ? {} : { knowledge: compiled.knowledge }),
    ...(compiled.skills === undefined ? {} : { skills: compiled.skills }),
    ...(compiled.instructions === undefined ? {} : { instructions: compiled.instructions }),
    ...(compiled.diagnosticDefinitions === undefined
      ? {}
      : { diagnosticDefinitions: compiled.diagnosticDefinitions }),
    runStatus: session.runStatus,
    runMetrics:
      session.runMetrics === null ? 'no run metrics yet' : renderMetrics(session.runMetrics),
  };
}
