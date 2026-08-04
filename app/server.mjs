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
  handleAiExplain,
  handleAiOptimize,
  handleConfig,
} from '../web/apps/ide/scripts/ai-endpoint.mjs';

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

function ensureMinGwinPath() {
  if (process.platform !== 'win32') return;
  const mingwBin = 'C:\\msys64\\ucrt64\\bin';
  if (existsSync(mingwBin) && !(process.env.PATH ?? '').split(';').includes(mingwBin)) {
    process.env.PATH = `${mingwBin};${process.env.PATH ?? ''}`;
  }
}

function findLpServer() {
  if (process.env.LP_SERVER && existsSync(process.env.LP_SERVER)) {
    return process.env.LP_SERVER;
  }
  const exe = process.platform === 'win32' ? 'lp-server.exe' : 'lp-server';
  for (const dir of ['integration-dev', 'local-mingw']) {
    const candidate = join(root, 'build', dir, 'kernel', exe);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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

async function startGateway() {
  const exe = findLpServer();
  if (!exe) {
    throw new Error(
      'lp-server not found (set LP_SERVER or build the kernel)',
    );
  }
  const port = await freePort();
  ensureMinGwinPath();
  const child = spawn(exe, ['--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
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
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/api/ai-build') {
      await handleAiBuild(req, res);
      return;
    }
    if (pathname === '/api/ai-optimize') {
      await handleAiOptimize(req, res);
      return;
    }
    if (pathname === '/api/ai-explain') {
      await handleAiExplain(req, res);
      return;
    }
    if (pathname === '/api/config') {
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
  // The Tauri parent exits -> its stdout pipe closes -> shut the gateway.
  process.stdout.on('end', shutdown);
  process.stdout.on('close', shutdown);
}

main().catch((error) => {
  console.error(`[app-server] ${error?.message ?? error}`);
  process.exit(1);
});
