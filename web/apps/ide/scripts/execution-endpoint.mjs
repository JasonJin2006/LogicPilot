import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ExecutionTargetRegistry } from '../../../packages/plugin-catalog/dist/index.bundle.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PROCESS_TARGET = {
  schema: 'logicpilot.execution-target/v1',
  contractVersion: 1,
  id: 'logicpilot.process.runtime',
  artifactRef: { artifactId: 'workspace.model' },
  runtime: { kind: 'interpreter', pluginId: 'logicpilot.des' },
};

let registry;
let runner;

function getRegistry() {
  if (registry) return registry;
  registry = new ExecutionTargetRegistry();
  registry.register({ target: PROCESS_TARGET, execute: runProcess });
  return registry;
}

async function runProcess(request) {
  runner ??= import(pathToFileURL(join(process.cwd(), 'scripts', 'ai-build.mjs')).href).then(
    (module) => module.runModelDsl,
  );
  const runModelDsl = await runner;
  const inputs = request.inputs;
  if (typeof inputs !== 'object' || inputs === null || typeof inputs.dsl !== 'string') {
    throw Object.assign(new Error('execution request inputs must contain dsl'), { status: 400 });
  }
  let result;
  try {
    result = runModelDsl({ dsl: inputs.dsl, runParams: inputs.runParams });
  } catch {
    // Normalize compiler/CLI failures into the execution contract. Raw
    // command output can contain temporary absolute paths and must never cross
    // the HTTP boundary.
    result = { ok: false, metrics: null };
  }
  const runId = `run-${request.requestId}`;
  const run = {
    schema: 'logicpilot.execution-run/v1',
    contractVersion: 1,
    runId,
    requestId: request.requestId,
    targetId: request.targetId,
    artifactRef: PROCESS_TARGET.artifactRef,
    status: result.ok ? 'completed' : 'failed',
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(result.ok ? {} : { error: 'process runtime failed' }),
  };
  if (!result.ok || result.metrics === null) return { run };
  const digest = createHash('sha256').update(JSON.stringify(result.metrics)).digest('hex');
  return {
    run,
    evidence: {
      schema: 'logicpilot.execution-evidence/v1',
      contractVersion: 1,
      runId,
      digest,
      metrics: flattenMetrics(result.metrics),
    },
  };
}

function flattenMetrics(value) {
  const metrics = {};
  if (typeof value !== 'object' || value === null) return metrics;
  for (const [key, item] of Object.entries(value.summary ?? {})) {
    if (typeof item === 'number') metrics[key] = item;
    else if (typeof item === 'object' && item !== null && typeof item.mean === 'number')
      metrics[key] = item.mean;
  }
  return metrics;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('execution request is too large'), { status: 413 }));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

export async function handleExecution(req, res) {
  if (req.method === 'GET') {
    send(res, 200, {
      schema: 'logicpilot.execution-targets/v1',
      contractVersion: 1,
      targets: getRegistry().list(),
    });
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(req));
    if (payload?.action !== 'execute')
      throw Object.assign(new Error('execution action is required'), { status: 400 });
    const targetId = String(payload.targetId ?? '');
    if (!getRegistry().get(targetId))
      throw Object.assign(new Error('execution target is not registered'), { status: 404 });
    const result = await getRegistry().execute(targetId, {
      schema: 'logicpilot.execution-request/v1',
      contractVersion: 1,
      requestId: String(payload.requestId ?? `request-${Date.now()}`),
      targetId,
      seed: typeof payload.seed === 'number' ? payload.seed : undefined,
      inputs: payload.inputs,
    });
    send(res, 200, result);
  } catch (error) {
    send(res, error?.status ?? 500, {
      ok: false,
      error: error?.status ? error.message : 'execution failed',
    });
  }
}
