// Supervisor evidence for the async kernel execution path:
//  - children never block the event loop (a concurrent HTTP request is served
//    while a long child runs),
//  - a deadline reclaims the whole process tree (helper parent + grandchild),
//  - abort cancels with the same tree reclamation,
//  - settled calls leave no child-process handle behind.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProcessTimeoutError, execFileAsync } from './subprocess-supervisor.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lp-kernel-supervisor-'));

function script(name, body) {
  const path = join(directory, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function residualChildHandles() {
  return process
    ._getActiveHandles()
    .filter((handle) => handle?.constructor?.name === 'ChildProcess').length;
}

try {
  // 1. Success resolves with captured stdout/stderr.
  const ok = await execFileAsync({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("hello"); process.stderr.write("warn")'],
    timeoutMs: 10_000,
  });
  assert.equal(ok.stdout, 'hello');
  assert.equal(ok.stderr, 'warn');
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.signalCode, null);

  // 2. Non-zero exit rejects while still carrying the captured output.
  await assert.rejects(
    execFileAsync({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      timeoutMs: 10_000,
    }),
    (error) => {
      assert.equal(error.exitCode, 3);
      assert.equal(error.stderr, 'boom');
      return true;
    },
  );

  // 3. A missing command surfaces ENOENT instead of hanging.
  await assert.rejects(
    execFileAsync({ command: join(directory, 'no-such-binary'), args: [] }),
    (error) => error.code === 'ENOENT' || error.code === 'ESPAWN',
  );

  // 4. Deadline reclaims the whole tree and the event loop keeps ticking.
  const pidsFile = join(directory, 'tree-pids.txt');
  const longTree = script(
    'long-tree.mjs',
    `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      const grand = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync(${JSON.stringify(pidsFile)}, process.pid + ',' + grand.pid, 'utf8');
      setInterval(() => {}, 1000);
    `,
  );
  let ticks = 0;
  const heartbeat = setInterval(() => {
    ticks += 1;
  }, 25);
  const started = Date.now();
  await assert.rejects(
    execFileAsync({ command: process.execPath, args: [longTree], timeoutMs: 700 }),
    ProcessTimeoutError,
  );
  const elapsed = Date.now() - started;
  clearInterval(heartbeat);
  assert.ok(elapsed >= 500, `timeout settled too early (${elapsed}ms)`);
  assert.ok(elapsed < 5_000, `timeout settle took ${elapsed}ms`);
  assert.ok(ticks >= 10, `event loop stalled during the child run (${ticks} ticks)`);
  // taskkill needs a moment to release the pids; the supervisor already
  // settled, so this only asserts the OS-level state.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const [ownPid, grandPid] = readFileSync(pidsFile, 'utf8').trim().split(',').map(Number);
  assert.equal(
    isProcessAlive(ownPid),
    false,
    `timeout left the helper process alive (${ownPid})`,
  );
  assert.equal(
    isProcessAlive(grandPid),
    false,
    `timeout left the grandchild alive (${grandPid})`,
  );
  assert.equal(residualChildHandles(), 0, 'supervisor left a child-process handle behind');

  // 5. Abort cancels the same way as the deadline.
  const aborting = new AbortController();
  const pending = execFileAsync({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 20_000,
    signal: aborting.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  aborting.abort();
  await assert.rejects(pending, (error) => error.code === 'EABORTED' && error.aborted === true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(residualChildHandles(), 0, 'abort left a child-process handle behind');

  // 6. A concurrent HTTP request is served while a long child runs.
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('pong');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const longTask = execFileAsync({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 2500)'],
    timeoutMs: 15_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const requestAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const requestMs = Date.now() - requestAt;
  assert.equal(await response.text(), 'pong');
  assert.ok(requestMs < 1_000, `heartbeat was blocked for ${requestMs}ms`);
  const completed = await longTask;
  assert.equal(completed.exitCode, 0);
  await new Promise((resolve) => server.close(resolve));

  console.log('KERNEL-SUPERVISOR TEST: PASS');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
