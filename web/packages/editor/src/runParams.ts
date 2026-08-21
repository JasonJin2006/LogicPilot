// Live-run parameter extraction: standard M/M/c-shaped process models receive
// optimized driver parameters; every other process topology is handed to the
// generic ProcessFlowSim gateway path after DSL compilation.

import type { ModelDocument, ModelNode } from './graph.js';

export interface ModelRunParams {
  ok: boolean;
  lambda?: number;
  mu?: number;
  servers?: number;
  failureRate?: number;
  repairRate?: number;
  error?: string;
}

// rate(c) / poisson(c) / exponential(c): the M/M/1 driver takes the rate.
const RATE_CALL = /^(?:rate|poisson|exponential)\(\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s*\)$/;

function parseRate(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'number') {
    return value > 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(RATE_CALL);
  if (!match) {
    return null;
  }
  const rate = Number(match[1]);
  return rate > 0 ? rate : null;
}

function toNumber(value: string | number | boolean | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function modelRunParams(document: ModelDocument): ModelRunParams {
  const hasProcessFlow = document.nodes.some(
    (node) =>
      node.library === 'process' ||
      node.library === undefined ||
      ['source', 'service', 'queue', 'resource'].includes(node.kind),
  );
  // Standalone method models (statechart / agent / continuous / DEVS) carry
  // no process-flow blocks: the gateway runs them without M/M/1 parameters.
  if (!hasProcessFlow) {
    return { ok: true };
  }
  const sources = document.nodes.filter((node) => node.kind === 'source');
  const services = document.nodes.filter((node) => node.kind === 'service');
  // A generic process topology does not need the optimized driver's shape.
  // Its structural and parameter diagnostics come from the compiler, which
  // is the authoritative validator for ProcessFlowSim models.
  if (sources.length !== 1 || services.length !== 1) return { ok: true };

  const source = sources[0]!;
  const lambda = parseRate(source.params['arrival']);
  if (lambda === null) {
    return { ok: true };
  }

  const service = services[0]!;
  const time = service.params['time'];
  const mu = parseRate(time);
  if (mu === null) {
    return { ok: true };
  }

  const resourceRef =
    typeof service.params['resource'] === 'string' ? service.params['resource'] : '';
  const resource = document.nodes.find(
    (node): node is ModelNode => node.kind === 'resource' && node.name === resourceRef,
  );
  if (!resource) {
    return { ok: true };
  }

  const servers = Math.max(1, Math.floor(toNumber(resource.params['capacity'], 1)));
  const failureRate = Math.max(0, toNumber(resource.params['failure_rate'], 0));
  const repairRate = Math.max(0, toNumber(resource.params['repair_rate'], 1));

  return { ok: true, lambda, mu, servers, failureRate, repairRate };
}
