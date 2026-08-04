// HTTP endpoint wrapping the AI model build loop for the IDE dev server.
//
// Mounted at /api/ai-build by vite.config.ts (dev only). POST
//   { "prompt": "...", "run": true, "maxIterations": 3 }
// returns the loop result as JSON:
//   { ok, iterations, dsl, diagnostics[], runSummary }
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
  const buildModel = await loadBuildModel();
  try {
    const result = await buildModel({
      prompt,
      maxIterations:
          Number.isFinite(payload.maxIterations) ? payload.maxIterations : 3,
      run: payload.run !== false,
    });
    send(res, 200, {
      ok: result.ok,
      iterations: result.iterations,
      dsl: result.dsl,
      diagnostics: result.lastDiagnostics,
      runSummary: result.runSummary,
    });
  } catch (error) {
    send(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
}
