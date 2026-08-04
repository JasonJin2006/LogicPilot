// Live-run parameter extraction (P1-7): the streaming gateway lowers process
// models to the M/M/1 driver, so a canvas model must be mm1-shaped with
// exponential arrivals/service times to run live. Maps the block graph onto
// the driver's (lambda, mu, servers, failure_rate, repair_rate) or returns a
// human-readable reason the model cannot stream.

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
  const sources = document.nodes.filter((node) => node.kind === 'source');
  const services = document.nodes.filter((node) => node.kind === 'service');
  if (sources.length !== 1) {
    return { ok: false, error: `live run needs exactly one source (found ${sources.length})` };
  }
  if (services.length !== 1) {
    return { ok: false, error: `live run needs exactly one service (found ${services.length})` };
  }

  const source = sources[0]!;
  const lambda = parseRate(source.params['arrival']);
  if (lambda === null) {
    return {
      ok: false,
      error: "source 'arrival' must be rate(c)/poisson(c)/exponential(c) for live streaming",
    };
  }

  const service = services[0]!;
  const time = service.params['time'];
  const mu = parseRate(time);
  if (mu === null) {
    return {
      ok: false,
      error: `service 'time' must be exponential(c) for live streaming (got '${String(time ?? '')}')`,
    };
  }

  const resourceRef =
    typeof service.params['resource'] === 'string' ? service.params['resource'] : '';
  const resource = document.nodes.find(
    (node): node is ModelNode => node.kind === 'resource' && node.name === resourceRef,
  );
  if (!resource) {
    return { ok: false, error: `service references unknown resource '${resourceRef}'` };
  }

  const servers = Math.max(1, Math.floor(toNumber(resource.params['capacity'], 1)));
  const failureRate = Math.max(0, toNumber(resource.params['failure_rate'], 0));
  const repairRate = Math.max(0, toNumber(resource.params['repair_rate'], 1));

  return { ok: true, lambda, mu, servers, failureRate, repairRate };
}
