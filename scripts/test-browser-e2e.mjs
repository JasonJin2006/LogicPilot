// Cross-platform launcher for the full IDE browser verification.
// Starts the same local gateway/Vite pair used by CI, then tears both down
// even when Playwright fails.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

import { findLpcli, logicPilotRoot } from './tool-paths.mjs';

const root = logicPilotRoot();
const explicitLpcli = process.argv.indexOf('--lpcli');
const lpcli =
  (explicitLpcli >= 0 ? process.argv[explicitLpcli + 1] : undefined) ??
  process.env.LPCLI ??
  findLpcli();
assert.ok(lpcli && existsSync(lpcli), `lpcli not found: ${lpcli ?? '(unset)'}`);

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

const browserPort = await freePort();
const pnpmArgs = ['--filter', '@logicpilot/ide', 'dev', '--host', '127.0.0.1', '--port', String(browserPort)];
const gateway = spawn(lpcli, ['serve', 'examples/mm1.lp', '--port', '8089'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
const vite = spawn(
  process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm',
  process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${pnpmArgs.join(' ')}`] : pnpmArgs,
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  },
);

async function waitForVite(timeoutMs = 60_000) {
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
  throw new Error('Vite did not become ready within 60 seconds');
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
      // The process may already have exited between the check and taskkill.
    }
  } else {
    child.kill('SIGTERM');
  }
}

try {
  await waitForVite();
  const result = spawn(
    process.execPath,
    [join(root, 'web', 'apps', 'ide', 'scripts', 'browser-verify.mjs')],
    {
      cwd: root,
      env: { ...process.env, LOGICPILOT_BROWSER_PORT: String(browserPort) },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    result.once('error', reject);
    result.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  stopProcess(vite);
  stopProcess(gateway);
}
