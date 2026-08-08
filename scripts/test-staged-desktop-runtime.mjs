// Hermetic runtime smoke: start the staged Node + app server + native
// sidecars with no repository build directories or machine Node on PATH.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const flag = process.argv.indexOf('--stage');
const stage = resolve(flag >= 0 && process.argv[flag + 1]
  ? process.argv[flag + 1]
  : 'build/desktop-runtime');
const executable = (name) => join(stage, 'runtime', name);
const node = executable(join('node', process.platform === 'win32' ? 'node.exe' : 'node'));
const lpcli = executable(join('bin', process.platform === 'win32' ? 'lpcli.exe' : 'lpcli'));
const lpserver = executable(join('bin', process.platform === 'win32' ? 'lp-server.exe' : 'lp-server'));
for (const path of [node, lpcli, lpserver, join(stage, 'app', 'server.mjs')]) {
  assert.ok(existsSync(path), `staged runtime file missing: ${path}`);
}
const manifest = JSON.parse(readFileSync(join(stage, 'runtime-manifest.json'), 'utf8'));
assert.equal(manifest.format, 1);
assert.ok(manifest.files.length > 10);
assert.match(manifest.nodeVersion, /^v(?:2\d|[3-9]\d)\./);
for (const entry of manifest.files) {
  assert.equal(typeof entry.path, 'string');
  const file = resolve(stage, entry.path);
  const fromStage = relative(stage, file);
  assert.ok(fromStage && !fromStage.startsWith('..') && !isAbsolute(fromStage),
    `manifest path escapes stage: ${entry.path}`);
  assert.ok(existsSync(file), `manifest file missing: ${entry.path}`);
  const content = readFileSync(file);
  assert.equal(content.byteLength, entry.bytes, `manifest size mismatch: ${entry.path}`);
  assert.equal(
    createHash('sha256').update(content).digest('hex'),
    entry.sha256,
    `manifest hash mismatch: ${entry.path}`,
  );
}

const systemPath = process.platform === 'win32'
  ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env.SystemRoot ?? 'C:\\Windows'}`
  : '/usr/bin:/bin';
const child = spawn(node, [join(stage, 'app', 'server.mjs')], {
  cwd: stage,
  env: {
    ...process.env,
    LOGICPILOT_ROOT: stage,
    LPCLI: lpcli,
    LP_SERVER: lpserver,
    PATH: `${join(stage, 'runtime', 'bin')}${process.platform === 'win32' ? ';' : ':'}${systemPath}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
const port = await new Promise((resolvePort, reject) => {
  let stdout = '';
  const timeout = setTimeout(() => reject(new Error('staged app server startup timed out')), 20_000);
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const match = stdout.match(/LOGICPILOT_PORT (\d+)/);
    if (match) {
      clearTimeout(timeout);
      resolvePort(Number(match[1]));
    }
  });
  child.once('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`staged app server exited (${code}): ${stderr}`));
  });
});

try {
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/`)).status, 200);
  const build = await fetch(`${base}/api/ai-build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'build an M/M/1 queue with arrival rate 0.8 and service rate 1.0',
      run: true,
      maxIterations: 2,
    }),
  });
  assert.equal(build.status, 200);
  const result = await build.json();
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.metrics.blocks.some((block) => block.kind === 'queue'));
  console.log('STAGED-DESKTOP-RUNTIME TEST: PASS');
} finally {
  child.kill();
}
