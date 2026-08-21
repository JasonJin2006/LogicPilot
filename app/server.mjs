// LogicPilot desktop app server: the production backend for the IDE. Serves
// the built frontend, mounts the AI endpoints (shared with the vite dev
// server) and manages the lp-server gateway on a free port. The Tauri shell
// spawns this process and reads `LOGICPILOT_PORT <n>` (window URL) and
// `LOGICPILOT_WS_PORT <n>` (gateway) from stdout.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleAiAssistant,
  handleAiAssistantStream,
  handleAiProviderModels,
  handleAiProviders,
  handleAiProviderTest,
  handleMcpCall,
  handleMcpCapabilities,
  handleAiBuild,
  handleAiCompareMetrics,
  handleAiExplain,
  handleAiOptimize,
  handleAiPatch,
  handleParameterVariation,
  handleAiQueryMetrics,
  handleAiRun,
  handleAiValidate,
  handleConfig,
} from '../web/apps/ide/scripts/ai-endpoint.mjs';
import { createApiRequestPolicy } from './request-policy.mjs';
import { extendNativeRuntimePath, findLpServer } from '../scripts/tool-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DIST = join(root, 'web', 'apps', 'ide', 'dist');
const LOOPBACK_HOST = '127.0.0.1';
const runWithApiPolicy = createApiRequestPolicy();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function ensureMinGwinPath(executable) {
  if (process.platform !== 'win32') return;
  if (!/[\\/](?:local-mingw|local-gcc)[\\/]/i.test(executable)) return;
  const mingwBin = 'C:\\msys64\\ucrt64\\bin';
  if (existsSync(mingwBin) && !(process.env.PATH ?? '').split(';').includes(mingwBin)) {
    process.env.PATH = `${mingwBin};${process.env.PATH ?? ''}`;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-LogicPilot-Local-Only', 'true');
}

async function startGateway() {
  const exe = findLpServer();
  if (!exe) {
    throw new Error('lp-server not found (set LP_SERVER or build the kernel)');
  }
  const port = await freePort();
  ensureMinGwinPath(exe);
  extendNativeRuntimePath(exe);
  const child = spawn(exe, ['--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // lp-server is a console-subsystem binary: without this flag Windows
    // pops a separate terminal window next to the GUI app.
    windowsHide: true,
  });
  // The gateway's own parent watchdog (lp-server) uses this pid to exit when
  // the app server dies hard; expose it for ops/tests (crash-cleanup checks).
  process.stdout.write(`LOGICPILOT_GATEWAY_PID ${child.pid}\n`);
  child.stdout.on('data', (chunk) => process.stdout.write(`[lp-server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[lp-server] ${chunk}`));
  child.on('exit', (code) => {
    process.stderr.write(`[lp-server] exited (${code})\n`);
  });
  return { port, child };
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = join(DIST, relative);
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(candidate);
    res.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const gateway = await startGateway();
  process.env.LOGICPILOT_WS_URL = `ws://127.0.0.1:${gateway.port}/sim`;

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const origin = req.headers.origin;
    if (pathname.startsWith('/api/') && origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
      // Tauri desktop WebViews serve the page from a synthetic origin
      // (tauri://localhost on v1, http(s)://tauri.localhost on v2) and call
      // the local API cross-origin. Those are first-party and must be
      // allowed; any other cross-origin caller is still rejected.
      const tauriOrigin =
        origin === 'tauri://localhost' ||
        origin === 'http://tauri.localhost' ||
        origin === 'https://tauri.localhost';
      if (!sameOrigin && !tauriOrigin) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'cross-origin API access denied' }));
        return;
      }
    }
    if (pathname === '/api/ai-providers/test') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiProviderTest(req, res));
      return;
    }
    if (pathname === '/api/ai-providers/models') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiProviderModels(req, res));
      return;
    }
    if (pathname === '/api/ai-providers') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiProviders(req, res));
      return;
    }
    if (pathname === '/api/mcp/capabilities') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleMcpCapabilities(req, res));
      return;
    }
    if (pathname === '/api/mcp/call') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleMcpCall(req, res));
      return;
    }
    if (pathname === '/api/ai-build') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiBuild(req, res));
      return;
    }
    if (pathname === '/api/ai-optimize') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiOptimize(req, res));
      return;
    }
    if (pathname === '/api/ai-run') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiRun(req, res));
      return;
    }
    if (pathname === '/api/parameter-variation') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleParameterVariation(req, res));
      return;
    }
    if (pathname === '/api/ai-validate') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiValidate(req, res));
      return;
    }
    if (pathname === '/api/ai-patch') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiPatch(req, res));
      return;
    }
    if (pathname === '/api/ai-query-metrics') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiQueryMetrics(req, res));
      return;
    }
    if (pathname === '/api/ai-compare-metrics') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiCompareMetrics(req, res));
      return;
    }
    if (pathname === '/api/ai-explain') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiExplain(req, res));
      return;
    }
    if (pathname === '/api/assistant') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiAssistant(req, res));
      return;
    }
    if (pathname === '/api/assistant/stream') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleAiAssistantStream(req, res));
      return;
    }
    if (pathname === '/api/config') {
      setCors(res);
      await runWithApiPolicy(req, res, () => handleConfig(req, res));
      return;
    }
    if (await serveStatic(pathname, res)) {
      return;
    }
    // SPA fallback.
    await serveStatic('/index.html', res);
  });

  const httpPort = await freePort();
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.listen(httpPort, LOOPBACK_HOST, () => {
    console.log(`LOGICPILOT_PORT ${httpPort}`);
    console.log(`LOGICPILOT_WS_PORT ${gateway.port}`);
    console.log(
      `LogicPilot app server: http://127.0.0.1:${httpPort}  gateway ws://127.0.0.1:${gateway.port}/sim`,
    );
  });

  const shutdown = () => {
    gateway.child.kill();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Watch the parent: the Tauri shell can be killed hard (crash / force
  // quit), which never runs its tree-kill; shut down then so the gateway is
  // not left orphaned next to the dead app.
  const parentPid = process.ppid;
  const parentWatchdog = setInterval(() => {
    let alive = true;
    try {
      process.kill(parentPid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      clearInterval(parentWatchdog);
      shutdown();
    }
  }, 2000);
  // The Tauri parent exits -> its stdout pipe closes -> shut the gateway.
  process.stdout.on('end', shutdown);
  process.stdout.on('close', shutdown);
}

main().catch((error) => {
  console.error(`[app-server] ${error?.message ?? error}`);
  process.exit(1);
});
