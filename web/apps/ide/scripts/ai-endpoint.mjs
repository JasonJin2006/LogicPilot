// HTTP endpoints for the IDE dev server: one-shot AI actions (build,
// optimize, run, parameter-variation, explain, compare, query-metrics),
// provider state/models/test, MCP capabilities/call, the assistant chat +
// stream and the app config. Mounted by vite.config.ts (dev only).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { API_MAX_BODY_BYTES } from '../../../../app/request-policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> ide -> apps -> web -> repo root.
const root = join(here, '..', '..', '..', '..');

async function loadBuildModel() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.buildModel;
}

async function loadRunModelDsl() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.runModelDsl;
}

async function loadValidateModelDsl() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
  return module.validateModelDsl;
}

async function loadProposeModelPatch() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-model-patch.mjs')).href);
  return module.proposeModelPatch;
}

async function loadQueryMetrics() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-query-metrics.mjs')).href);
  return module.queryMetrics;
}

async function loadCompareMetrics() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-compare-metrics.mjs')).href);
  return module.compareMetrics;
}

async function loadAiOptimize() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-optimize.mjs')).href);
  return module.aiOptimize;
}

async function loadAiExplain() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-explain.mjs')).href);
  return module.aiExplain;
}

async function loadAssistant() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-assistant.mjs')).href);
  return module.runAssistant;
}

async function loadAssistantConnectionTest() {
  const module = await import(pathToFileURL(join(root, 'scripts', 'ai-assistant.mjs')).href);
  return module.testAssistantConnection;
}

async function loadAssistantProtocol() {
  return import(pathToFileURL(join(root, 'scripts', 'ai-assistant.mjs')).href);
}

async function loadProviderConfig() {
  return import(pathToFileURL(join(root, 'scripts', 'ai-provider-config.mjs')).href);
}

async function loadProviderAdapters() {
  return import(pathToFileURL(join(root, 'scripts', 'ai-provider-adapters.mjs')).href);
}

async function loadMcpRuntime() {
  return import(pathToFileURL(join(root, 'scripts', 'mcp-runtime.mjs')).href);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > API_MAX_BODY_BYTES && !settled) {
        settled = true;
        req.removeAllListeners('data');
        req.resume();
        const error = new Error(`request body exceeds ${API_MAX_BODY_BYTES} bytes`);
        error.status = 413;
        reject(error);
        return;
      }
      if (settled) return;
      body += chunk;
    });
    req.on('end', () => {
      if (!settled) resolve(body);
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function send(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function sendSse(res, event) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendBodyError(res, error) {
  const status = error?.status === 413 ? 413 : 400;
  send(res, status, {
    ok: false,
    error: status === 413 ? error.message : 'invalid JSON body',
  });
}

// Gateway discovery: the desktop app server injects the lp-server port via
// LOGICPILOT_WS_URL; the vite dev server falls back to the default.
export function handleConfig(req, res) {
  const configuredEngine = process.env.LOGICPILOT_AGENT_ENGINE;
  send(res, 200, {
    wsUrl: process.env.LOGICPILOT_WS_URL ?? 'ws://127.0.0.1:8089/sim',
    agentEngine: configuredEngine === 'sdk.openai-agents' ? configuredEngine : 'builtin',
    ...(process.env.LOGICPILOT_SESSION_TOKEN
      ? { sessionToken: process.env.LOGICPILOT_SESSION_TOKEN }
      : {}),
  });
}

export async function handleAiProviders(req, res) {
  const providerConfig = await loadProviderConfig();
  if (req.method === 'GET') {
    send(res, 200, providerConfig.getAssistantProviderState());
    return;
  }
  if (req.method === 'DELETE') {
    providerConfig.clearAssistantProviderSession();
    send(res, 200, providerConfig.getAssistantProviderState());
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(req));
    send(res, 200, providerConfig.configureAssistantProvider(payload));
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) });
  }
}

/** Discover the provider's current model catalog using server-side secrets. */
export async function handleAiProviderModels(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  try {
    let input;
    if (req.method === 'POST') {
      const raw = await readBody(req);
      if (raw.length > 64 * 1024) {
        send(res, 413, { ok: false, error: 'provider configuration is too large' });
        return;
      }
      try {
        input = raw.trim() === '' ? undefined : JSON.parse(raw);
      } catch (error) {
        sendBodyError(res, error);
        return;
      }
    }
    const providerConfig = await loadProviderConfig();
    const config =
      input === undefined
        ? providerConfig.resolveAssistantConfiguration()
        : providerConfig.resolveAssistantConfigurationForModelList(input);
    if (config.source === 'unconfigured') {
      send(res, 400, { ok: false, error: 'AI provider is not configured' });
      return;
    }
    const { listProviderModels } = await loadProviderAdapters();
    const models = await listProviderModels(config);
    send(res, 200, {
      ok: true,
      providerId: config.providerId,
      protocol: config.protocol,
      models,
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    const status = /MODEL_LIST_UNSUPPORTED|not configured|required|unsupported AI protocol/i.test(
      message,
    )
      ? 400
      : 502;
    send(res, status, { ok: false, error: message });
  }
}

export async function handleAiProviderTest(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  const started = Date.now();
  try {
    const raw = await readBody(req);
    let payload = {};
    if (raw.trim() !== '') {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        sendBodyError(res, error);
        return;
      }
    }
    const testAssistantConnection = await loadAssistantConnectionTest();
    const hasDraft =
      payload !== null && typeof payload === 'object' && Object.keys(payload).length > 0;
    await testAssistantConnection(hasDraft ? { provider: payload } : {});
    const { getAssistantProviderState } = await loadProviderConfig();
    send(res, 200, {
      ok: true,
      latencyMs: Date.now() - started,
      active: getAssistantProviderState().active,
    });
  } catch (error) {
    send(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleMcpCapabilities(req, res) {
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  try {
    const { discoverMcpCapabilities } = await loadMcpRuntime();
    send(res, 200, { ok: true, servers: await discoverMcpCapabilities() });
  } catch (error) {
    send(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleMcpCall(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(req));
    if (
      typeof payload?.serverId !== 'string' ||
      typeof payload?.name !== 'string' ||
      payload.serverId.trim() === '' ||
      payload.name.trim() === ''
    ) {
      send(res, 400, { ok: false, error: 'serverId and name are required' });
      return;
    }
    const { callMcpTool } = await loadMcpRuntime();
    const result = await callMcpTool(payload.serverId, payload.name, payload.arguments ?? {});
    send(res, 200, { ok: true, result });
  } catch (error) {
    send(res, 502, { ok: false, error: String(error?.message ?? error) });
  }
}

export async function handleAiBuild(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendBodyError(res, error);
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
      maxIterations: Number.isFinite(payload.maxIterations) ? payload.maxIterations : 3,
      run: payload.run !== false,
      runParams: payload?.experiment,
    });
    send(res, 200, {
      ok: result.ok,
      iterations: result.iterations,
      dsl: result.dsl,
      provider: result.provider,
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
  const module = await import(pathToFileURL(join(root, 'scripts', 'parameter-variation.mjs')).href);
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
  } catch (error) {
    sendBodyError(res, error);
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
  } catch (error) {
    sendBodyError(res, error);
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
      axes: Array.isArray(payload?.axes) ? payload.axes : undefined,
      sampling: payload?.sampling === 'monte_carlo' ? 'monte_carlo' : 'grid',
      samples: Number.isSafeInteger(payload?.samples) ? payload.samples : 10,
      seed: Number.isSafeInteger(payload?.seed) ? payload.seed : 1,
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
  } catch (error) {
    sendBodyError(res, error);
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
  } catch (error) {
    sendBodyError(res, error);
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
  } catch (error) {
    sendBodyError(res, error);
    return;
  }
  if (JSON.stringify(payload?.metrics ?? null).length > 8 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'metrics are too large' });
    return;
  }
  try {
    const queryMetrics = await loadQueryMetrics();
    send(
      res,
      200,
      queryMetrics({
        question: payload?.question,
        metrics: payload?.metrics,
      }),
    );
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
  } catch (error) {
    sendBodyError(res, error);
    return;
  }
  if (JSON.stringify([payload?.before ?? null, payload?.after ?? null]).length > 16 * 1024 * 1024) {
    send(res, 413, { ok: false, error: 'metrics are too large' });
    return;
  }
  try {
    const compareMetrics = await loadCompareMetrics();
    send(
      res,
      200,
      compareMetrics({
        before: payload?.before,
        after: payload?.after,
        confidence: Number.isFinite(payload?.confidence) ? payload.confidence : 0.95,
      }),
    );
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
  } catch (error) {
    sendBodyError(res, error);
    return;
  }
  const prompt = String(payload?.prompt ?? '').trim();
  if (!prompt) {
    send(res, 400, { ok: false, error: 'missing prompt' });
    return;
  }
  try {
    const aiOptimize = await loadAiOptimize();
    const result = await aiOptimize({ prompt, contextDsl: String(payload?.contextDsl ?? '') });
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
  } catch (error) {
    sendBodyError(res, error);
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

// Assistant Runtime step endpoint: stateless per call; the client owns the
// plan -> tool call -> result loop. The API key stays server-side.
export async function handleAiAssistant(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendBodyError(res, error);
    return;
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    send(res, 400, { ok: false, error: 'missing messages' });
    return;
  }
  if (
    messages.length > 32 ||
    messages.some(
      (message) =>
        message === null ||
        typeof message !== 'object' ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string',
    )
  ) {
    send(res, 400, { ok: false, error: 'invalid assistant messages' });
    return;
  }
  const { normalizeAssistantMessageToolCallIds, validateAssistantMessages } =
    await loadAssistantProtocol();
  const normalizedMessages = normalizeAssistantMessageToolCallIds(messages);
  const messageProblem = validateAssistantMessages(normalizedMessages);
  if (messageProblem) {
    send(res, 400, { ok: false, error: messageProblem });
    return;
  }
  const context = payload?.context ?? null;
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : undefined;
  const skills = Array.isArray(payload?.skills) ? payload.skills : undefined;
  const toolNames = Array.isArray(payload?.toolNames) ? payload.toolNames : undefined;
  const toolDescriptors = Array.isArray(payload?.toolDescriptors)
    ? payload.toolDescriptors
    : undefined;
  if (
    JSON.stringify({ messages: normalizedMessages, context, toolNames, toolDescriptors }).length >
    2 * 1024 * 1024
  ) {
    send(res, 413, { ok: false, error: 'assistant payload is too large' });
    return;
  }
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  try {
    req.on('aborted', onAbort);
    res.on('close', onAbort);
    const runAssistant = await loadAssistant();
    const result = await runAssistant({
      messages: normalizedMessages,
      context,
      capabilities,
      skills,
      toolNames,
      toolDescriptors,
      signal: abortController.signal,
    });
    send(res, 200, result);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (
      /not configured|API key|LLM request failed|malformed JSON|schema validation|Codex CLI provider/.test(
        message,
      )
    ) {
      send(res, 502, { ok: false, error: message });
      return;
    }
    send(res, 500, { ok: false, error: message });
  } finally {
    req.removeListener('aborted', onAbort);
  }
}

/** Stream one assistant step as text/reasoning deltas, then emit its final response. */
export async function handleAiAssistantStream(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendBodyError(res, error);
    return;
  }
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const { normalizeAssistantMessageToolCallIds, validateAssistantMessages } =
    await loadAssistantProtocol();
  const normalizedMessages = normalizeAssistantMessageToolCallIds(messages);
  const messageProblem = validateAssistantMessages(normalizedMessages);
  if (messageProblem) {
    send(res, 400, { ok: false, error: messageProblem });
    return;
  }
  const context = payload?.context ?? null;
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : undefined;
  const skills = Array.isArray(payload?.skills) ? payload.skills : undefined;
  const toolNames = Array.isArray(payload?.toolNames) ? payload.toolNames : undefined;
  const toolDescriptors = Array.isArray(payload?.toolDescriptors)
    ? payload.toolDescriptors
    : undefined;
  if (
    JSON.stringify({ messages: normalizedMessages, context, toolNames, toolDescriptors }).length >
    2 * 1024 * 1024
  ) {
    send(res, 413, { ok: false, error: 'assistant payload is too large' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  try {
    req.on('aborted', onAbort);
    res.on('close', onAbort);
    const runAssistant = await loadAssistant();
    const result = await runAssistant({
      messages: normalizedMessages,
      context,
      capabilities,
      skills,
      toolNames,
      toolDescriptors,
      signal: abortController.signal,
      onChunk: (chunk) => sendSse(res, chunk),
    });
    sendSse(res, { type: 'done', response: result });
  } catch (error) {
    sendSse(res, { type: 'error', error: String(error?.message ?? error) });
  } finally {
    req.removeListener('aborted', onAbort);
    res.end();
  }
}
