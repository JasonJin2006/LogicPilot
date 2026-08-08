// HTTP endpoint wrapping the AI model build loop for the IDE dev server.
//
// Mounted at /api/ai-build and /api/ai-optimize by vite.config.ts (dev
// only). Both take { "prompt": "..." } and return JSON.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const root = join(here, '..', '..', '..', '..');

async function loadBuildModel() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.buildModel;
}

async function loadRunModelDsl() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.runModelDsl;
}

async function loadValidateModelDsl() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.validateModelDsl;
}

async function loadProposeModelPatch() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-model-patch.mjs')).href);
  return module.proposeModelPatch;
}

async function loadQueryMetrics() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-query-metrics.mjs')).href);
  return module.queryMetrics;
}

async function loadCompareMetrics() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-compare-metrics.mjs')).href);
  return module.compareMetrics;
}

async function loadAiOptimize() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-optimize.mjs')).href);
  return module.aiOptimize;
}

async function loadAiExplain() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'ai-explain.mjs')).href);
  return module.aiExplain;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// Gateway discovery: the desktop app server injects the lp-server port via
// LOGICPILOT_WS_URL; the vite dev server falls back to the default.
export function handleConfig(req, res) {
  send(res, 200, {
    wsUrl: process.env.LOGICPILOT_WS_URL ?? 'ws://127.0.0.1:8089/sim',
  });
}

export async function handleAiBuild(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const prompt = String(payload?.prompt ?? '').trim();
  if (!prompt) {
    send(res, 400, { ok: false, error: 'missing prompt' });
    return;
  }
  const contextDsl = String(payload?.contextDsl ?? '');
  if (contextDsl.length > 2 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'current model is too large' });
    return;
  }
  const buildModel = await loadBuildModel();
  try {
    const result = await buildModel({
      prompt,
      contextDsl,
      maxIterations:
          Number.isFinite(payload.maxIterations) ? payload.maxIterations : 3,
      run: payload.run !== false,
      runParams: payload?.experiment,
    });
    send(res, 200, {
      ok: result.ok,
      iterations: result.iterations,
      dsl: result.dsl,
      diagnostics: result.lastDiagnostics,
      runSummary: result.runSummary,
      metrics: result.metrics,
      trajectory: result.trajectory,
      verification: result.verification,
      experiment: result.experiment,
    });
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
}

async function loadParameterVariation() {
  const module = await import(
      pathToFileURL(join(root, 'scripts', 'parameter-variation.mjs')).href);
  return module.runParameterVariation;
}

export async function handleAiRun(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const dsl = String(payload?.dsl ?? '');
  if (!dsl.trim()) {
    send(res, 400, { ok: false, error: 'missing model DSL' });
    return;
  }
  if (dsl.length > 2 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'model is too large' });
    return;
  }
  try {
    const runModelDsl = await loadRunModelDsl();
    const result = runModelDsl({
      dsl,
      runParams: {
        seed: Number.isFinite(payload?.seed) ? payload.seed : 42,
        seedMode: payload?.seedMode ?? 'fixed',
        reps: Number.isFinite(payload?.reps) ? payload.reps : 3,
        replicationMode: payload?.replicationMode ?? 'fixed',
        minReps: Number.isFinite(payload?.minReps) ? payload.minReps : 5,
        maxReps: Number.isFinite(payload?.maxReps) ? payload.maxReps : 100,
        errorPercent: Number.isFinite(payload?.errorPercent) ? payload.errorPercent : 5,
        precisionMetric: payload?.precisionMetric ?? 'Wq',
        arrivals: Number.isFinite(payload?.arrivals) ? payload.arrivals : 4000,
        warmup: Number.isFinite(payload?.warmup) ? payload.warmup : 400,
        confidence: Number.isFinite(payload?.confidence) ? payload.confidence : 0.95,
      },
    });
    send(res, 200, result);
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleParameterVariation(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const dsl = String(payload?.dsl ?? '');
  if (!dsl.trim()) {
    send(res, 400, { ok: false, error: 'missing model DSL' });
    return;
  }
  if (dsl.length > 2 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'model is too large' });
    return;
  }
  try {
    const runParameterVariation = await loadParameterVariation();
    const result = await runParameterVariation({
      dsl,
      experimentName: payload?.experimentName,
      arrivals: Number.isFinite(payload?.arrivals) ? payload.arrivals : 4000,
      warmup: Number.isFinite(payload?.warmup) ? payload.warmup : 400,
      concurrency: Number.isFinite(payload?.concurrency) ? payload.concurrency : undefined,
    });
    send(res, 200, { ok: true, ...result });
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiValidate(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const dsl = String(payload?.dsl ?? '');
  if (!dsl.trim()) {
    send(res, 400, { ok: false, error: 'missing model DSL' });
    return;
  }
  if (dsl.length > 2 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'model is too large' });
    return;
  }
  try {
    const validateModelDsl = await loadValidateModelDsl();
    send(res, 200, validateModelDsl({ dsl }));
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiPatch(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const prompt = String(payload?.prompt ?? '').trim();
  if (!prompt) {
    send(res, 400, { ok: false, error: 'missing prompt' });
    return;
  }
  const history = Array.isArray(payload?.history) ? payload.history.slice(-20) : [];
  if (JSON.stringify([payload?.model ?? null, history]).length > 2 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'current model or history is too large' });
    return;
  }
  try {
    const proposeModelPatch = await loadProposeModelPatch();
    send(res, 200, await proposeModelPatch({ prompt, model: payload?.model, history }));
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiQueryMetrics(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  if (JSON.stringify(payload?.metrics ?? null).length > 8 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'metrics are too large' });
    return;
  }
  try {
    const queryMetrics = await loadQueryMetrics();
    send(res, 200, queryMetrics({
      question: payload?.question,
      metrics: payload?.metrics,
    }));
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiCompareMetrics(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  if (JSON.stringify([payload?.before ?? null, payload?.after ?? null]).length > 16 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'metrics are too large' });
    return;
  }
  try {
    const compareMetrics = await loadCompareMetrics();
    send(res, 200, compareMetrics({
      before: payload?.before,
      after: payload?.after,
      confidence: Number.isFinite(payload?.confidence) ? payload.confidence : 0.95,
    }));
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiOptimize(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const prompt = String(payload?.prompt ?? '').trim();
  if (!prompt) {
    send(res, 400, { ok: false, error: 'missing prompt' });
    return;
  }
  try {
    const aiOptimize = await loadAiOptimize();
    const result = await aiOptimize({ prompt });
    send(res, 200, result);
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiExplain(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }
  const prompt = String(payload?.prompt ?? '').trim();
  if (!prompt) {
    send(res, 400, { ok: false, error: 'missing prompt' });
    return;
  }
  try {
    const aiExplain = await loadAiExplain();
    const result = await aiExplain({
      prompt,
      question: payload.question ?? 'why is throughput low?',
    });
    send(res, 200, result);
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
}
