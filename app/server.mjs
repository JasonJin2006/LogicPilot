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
import {
  extendNativeRuntimePath,
  findLpServer,
} from '../scripts/tool-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DIST = join(root, 'web', 'apps', 'ide', 'dist');

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
}

async function startGateway() {
  const exe = findLpServer();
  if (!exe) {
    throw new Error(
      'lp-server not found (set LP_SERVER or build the kernel)',
    );
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
    if (pathname === '/api/ai-build') {
      setCors(res);
      await handleAiBuild(req, res);
      return;
    }
    if (pathname === '/api/ai-optimize') {
      setCors(res);
      await handleAiOptimize(req, res);
      return;
    }
    if (pathname === '/api/ai-run') {
      setCors(res);
      await handleAiRun(req, res);
      return;
    }
    if (pathname === '/api/parameter-variation') {
      setCors(res);
      await handleParameterVariation(req, res);
      return;
    }
    if (pathname === '/api/ai-validate') {
      setCors(res);
      await handleAiValidate(req, res);
      return;
    }
    if (pathname === '/api/ai-patch') {
      setCors(res);
      await handleAiPatch(req, res);
      return;
    }
    if (pathname === '/api/ai-query-metrics') {
      setCors(res);
      await handleAiQueryMetrics(req, res);
      return;
    }
    if (pathname === '/api/ai-compare-metrics') {
      setCors(res);
      await handleAiCompareMetrics(req, res);
      return;
    }
    if (pathname === '/api/ai-explain') {
      setCors(res);
      await handleAiExplain(req, res);
      return;
    }
    if (pathname === '/api/config') {
      setCors(res);
      handleConfig(req, res);
      return;
    }
    if (await serveStatic(pathname, res)) {
      return;
    }
    // SPA fallback.
    await serveStatic('/index.html', res);
  });

  const httpPort = await freePort();
  server.listen(httpPort, '127.0.0.1', () => {
    console.log(`LOGICPILOT_PORT ${httpPort}`);
    console.log(`LOGICPILOT_WS_PORT ${gateway.port}`);
    console.log(`LogicPilot app server: http://127.0.0.1:${httpPort}  gateway ws://127.0.0.1:${gateway.port}/sim`);
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
