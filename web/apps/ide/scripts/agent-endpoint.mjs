const MAX_AGENT_BODY_BYTES = 4 * 1024 * 1024;
let engineModule;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_AGENT_BODY_BYTES && !settled) {
        settled = true;
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('agent step request is too large'), { status: 413 }));
        return;
      }
      if (!settled) body += chunk;
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
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

/** Provider-neutral SDK engine endpoint. The SDK receives only a validated
 * AgentStepRequest and returns one validated AgentStepResult. */
export async function handleAgentStep(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  if ((process.env.LOGICPILOT_AGENT_ENGINE ?? 'builtin') !== 'sdk.openai-agents') {
    send(res, 503, { ok: false, error: 'sdk agent engine is not enabled' });
    return;
  }
  try {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      if (error?.status === 413) throw error;
      throw Object.assign(new Error('request body is not valid JSON'), { status: 400 });
    }
    engineModule ??= await import('../../../packages/agent-openai/dist/index.bundle.js');
    const { validateContract } = engineModule;
    const request = validateContract('AgentStepRequest', payload);
    if (!request.ok) throw Object.assign(new Error(request.errors.join('; ')), { status: 400 });
    if (request.value.engineId !== 'sdk.openai-agents') {
      throw Object.assign(new Error('agent engine id is not enabled'), { status: 409 });
    }
    const engine = new engineModule.OpenAiAgentsEngine({
      model: process.env.OPENAI_MODEL,
    });
    const result = await engine.runStep(request.value);
    const checked = validateContract('AgentStepResult', result);
    if (!checked.ok) throw new Error(`SDK returned invalid step: ${checked.errors.join('; ')}`);
    send(res, 200, checked.value);
  } catch (error) {
    const status = error?.status ?? 500;
    send(res, status, {
      ok: false,
      error:
        status === 500
          ? 'agent engine step failed'
          : String(error?.message ?? 'agent request failed'),
    });
  }
}
