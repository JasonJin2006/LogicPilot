import { randomUUID } from 'node:crypto';
import { REQUEST_CANCEL_SIGNAL } from '../../../../app/request-policy.mjs';
import { validateContract } from '../../../packages/plugin-catalog/dist/index.bundle.js';
import {
  getNodeExecutionService,
  getNodeExecutionTargetRegistry,
  cancelKernelRun,
} from './plugin-catalog-bridge.mjs';
import { materializeExecutionSource, persistExecutionResult } from './execution-artifacts.mjs';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const error = (status, message) => Object.assign(new Error(message), { status });

// /api/execution is exclusively a view of the active plugin runtime. Generic
// AI compilation remains available through its own existing /api/ai-run route.
export function createExecutionHandler({
  getRegistry = getNodeExecutionTargetRegistry,
  getService = getNodeExecutionService,
  materialize = materializeExecutionSource,
  persist = persistExecutionResult,
  cancelRun = cancelKernelRun,
} = {}) {
  return async (req, res) => {
    try {
      const registry = getRegistry();
      const service = getService();
      const requestUrl = new URL(req.url ?? '/api/execution', 'http://logicpilot.local');
      const pathname = requestUrl.pathname;
      const modernRunsRoute = pathname === '/api/execution/runs';
      const modernRunMatch = pathname.match(/^\/api\/execution\/runs\/([^/]+)$/);
      const modernCommandMatch = pathname.match(/^\/api\/execution\/runs\/([^/]+)\/commands$/);
      if (req.method === 'GET') {
        if (modernRunsRoute) {
          if (!service) throw error(503, 'execution service is not configured');
          send(res, 200, {
            schema: 'logicpilot.execution-runs/v1',
            contractVersion: 1,
            sessions: service.list(),
          });
          return;
        }
        if (modernCommandMatch) throw error(405, 'method not allowed');
        const runId = modernRunMatch
          ? decodeRouteId(modernRunMatch[1])
          : requestUrl.searchParams.get('runId');
        if (runId !== null) {
          if (!service) throw error(503, 'execution service is not configured');
          const afterSeq = Number(requestUrl.searchParams.get('afterSeq') ?? '-1');
          const limit = Number(requestUrl.searchParams.get('limit') ?? '100');
          const result = service.events(runId, Number.isFinite(afterSeq) ? afterSeq : -1, limit);
          if (!result) throw error(404, 'execution run was not found');
          send(res, 200, {
            schema: 'logicpilot.execution-session-query/v1',
            contractVersion: 1,
            ...result,
          });
          return;
        }
        send(res, 200, {
          schema: 'logicpilot.execution-targets/v1',
          contractVersion: 1,
          targets: registry?.list() ?? [],
        });
        return;
      }
      if (req.method !== 'POST') throw error(405, 'method not allowed');
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (cause) {
        if (cause?.status) throw cause;
        throw error(400, 'invalid execution JSON');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw error(400, 'execution action is required');
      if (modernCommandMatch) {
        if (!service) throw error(503, 'execution service is not configured');
        const routeRunId = decodeRouteId(modernCommandMatch[1]);
        const command = payload.command ?? payload;
        if (!command || typeof command !== 'object' || Array.isArray(command))
          throw error(400, 'execution command is required');
        if (command.runId !== routeRunId) throw error(409, 'execution command run does not match route');
        const ack = await service.command(command);
        send(res, 200, ack);
        return;
      }
      if (payload.action === 'command') {
        if (!service) throw error(503, 'execution service is not configured');
        const ack = await service.command(payload.command);
        send(res, 200, ack);
        return;
      }
      const action = modernRunsRoute ? 'start' : payload.action;
      if (!['execute', 'start'].includes(action))
        throw error(400, 'execution action is required');
      const candidate = {
        schema: 'logicpilot.execution-request/v1',
        contractVersion: 1,
        requestId: payload.requestId ?? randomUUID(),
        targetId: payload.targetId,
        artifactRef: payload.artifactRef,
        seed: payload.seed,
        budget: payload.budget,
        inputs: payload.inputs,
      };
      const checked = validateContract('ExecutionRequest', candidate);
      if (!checked.ok) throw error(400, 'invalid execution request');
      // Server-side execution ceiling: a missing wall budget gets the server
      // default and anything above the hard limit is rejected before any
      // kernel side effect runs.
      const budget = applyServerBudget(checked.value.budget);
      const request =
        budget === checked.value.budget ? checked.value : { ...checked.value, budget };
      if (!registry?.get(request.targetId)) throw error(404, 'execution target is not registered');
      const source = materialize(request.artifactRef);
      if (source !== undefined) {
        if (
          request.inputs !== undefined &&
          (!request.inputs || typeof request.inputs !== 'object' || Array.isArray(request.inputs))
        )
          throw error(400, 'execution inputs must be an object');
        if (request.inputs?.dsl !== undefined && request.inputs.dsl !== source)
          throw error(409, 'execution inputs do not match the pinned artifact revision');
      }
      const resolved =
        source === undefined ? request : { ...request, inputs: { ...request.inputs, dsl: source } };
      if (action === 'start') {
        if (!service) throw error(503, 'execution service is not configured');
        const session = await service.start(resolved);
        void service
          .wait(session.runId)
          .then((result) => persist({ ...resolved, runId: session.runId }, result))
          .catch(() => undefined);
        send(res, 202, {
          schema: 'logicpilot.execution-start/v1',
          contractVersion: 1,
          session,
        });
        return;
      }
      // Cancel the in-flight kernel run when the client disconnects or the
      // request policy aborts the request; the disconnect listener is only
      // trusted when the response was never finished.
      const onPolicyAbort = () => cancelRun(request.requestId);
      const policySignal = req[REQUEST_CANCEL_SIGNAL];
      if (policySignal instanceof AbortSignal) {
        if (policySignal.aborted) {
          cancelRun(request.requestId);
          throw error(499, 'execution cancelled');
        } else policySignal.addEventListener('abort', onPolicyAbort, { once: true });
      }
      const onResponseClose = () => {
        if (!res.writableEnded) cancelRun(request.requestId);
      };
      if (typeof res.on === 'function') res.on('close', onResponseClose);
      try {
        const result = await registry.execute(request.targetId, resolved);
        if (policySignal instanceof AbortSignal && policySignal.aborted)
          throw error(499, 'execution cancelled');
        const refs = await persist(resolved, result);
        send(res, 200, {
          ...result,
          run: { ...result.run, ...(refs.evidenceRef ? { evidenceRef: refs.evidenceRef } : {}) },
        });
      } finally {
        if (policySignal instanceof AbortSignal)
          policySignal.removeEventListener('abort', onPolicyAbort);
        if (typeof res.removeListener === 'function') res.removeListener('close', onResponseClose);
      }
    } catch (cause) {
      send(res, cause?.status ?? 500, {
        ok: false,
        error: cause?.status ? cause.message : 'execution failed',
      });
    }
  };
}
export const handleExecution = createExecutionHandler();

function decodeRouteId(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes('/') || decoded.includes('\\'))
      throw error(400, 'invalid execution run id');
    return decoded;
  } catch (cause) {
    if (cause?.status) throw cause;
    throw error(400, 'invalid execution run id');
  }
}

/** Hard ceiling for a single execution request (10 minutes). Requests without
 * a wall budget are given this default so an unbounded kernel run cannot
 * pin the local machine forever. */
export const MAX_EXECUTION_WALL_MS = 10 * 60 * 1000;

function applyServerBudget(budget) {
  if (budget === undefined) return { maxWallMs: MAX_EXECUTION_WALL_MS };
  if (Number.isSafeInteger(budget.maxWallMs) && budget.maxWallMs > MAX_EXECUTION_WALL_MS)
    throw error(400, 'execution budget exceeds the server limit');
  if (budget.maxWallMs === undefined) return { ...budget, maxWallMs: MAX_EXECUTION_WALL_MS };
  return budget;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(error(413, 'execution request is too large'));
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}
function send(res, status, payload) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}
