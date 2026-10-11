// Launcher for the 3D Scene panel's browser verification.
//
// Mirrors scripts/test-browser-e2e.mjs: it starts the Vite dev server the IDE
// needs, waits for readiness, runs the Playwright verifier, then tears the
// server down even when the verifier fails.
//
// The runtime gateway is started too: the agent-animation checks need a live
// simulation, and the IDE's runtime page connects to the gateway's fixed port.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

import { findLpcli } from './tool-paths.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(existsSync(join(root, 'web', 'apps', 'ide', 'package.json')), 'IDE package not found');

// The gateway serves the wire frames the agent animation consumes. Its port is
// fixed because the IDE's runtime page points at 8089 by default.
const lpcli = process.env.LPCLI ?? findLpcli();
assert.ok(lpcli && existsSync(lpcli), `lpcli not found: ${lpcli ?? '(unset)'}`);
const GATEWAY_PORT = '8089';

const explicit = process.argv.indexOf('--port');
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

const browserPort = explicit >= 0 ? Number(process.argv[explicit + 1]) : await freePort();
const pnpmArgs = [
  '--filter',
  '@logicpilot/ide',
  'dev',
  '--host',
  '127.0.0.1',
  '--port',
  String(browserPort),
];
const gateway = spawn(lpcli, ['serve', join(root, 'examples', 'mm1.lp'), '--port', GATEWAY_PORT], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

const vite = spawn(
  process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm',
  process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${pnpmArgs.join(' ')}`] : pnpmArgs,
  { cwd: root, stdio: 'inherit', windowsHide: true },
);

async function waitForVite(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited before readiness (${vite.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${browserPort}`);
      if (response.ok) return;
    } catch {
      // Keep polling while Vite is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Vite did not become ready within 90 seconds');
}

function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // The process may already have exited.
    }
  } else {
    child.kill('SIGTERM');
  }
}

let exitCode = 1;
try {
  await waitForVite();
  const verify = spawn(
    process.execPath,
    [join(root, 'web', 'apps', 'ide', 'scripts', 'scene3d-verify.mjs')],
    {
      cwd: root,
      env: { ...process.env, LOGICPILOT_BROWSER_PORT: String(browserPort) },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  exitCode = await new Promise((resolve) => verify.once('exit', (code) => resolve(code ?? 1)));
} catch (error) {
  console.error(`scene3d-browser: ${error.message}`);
  exitCode = 1;
} finally {
  stopProcess(vite);
  stopProcess(gateway);
}

process.exit(exitCode);
