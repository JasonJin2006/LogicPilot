// Production desktop backend smoke test:
// app/server.mjs -> built IDE + runtime config + AI build -> lpcli metrics.
//
// Usage:
//   node scripts/test-app-server.mjs [--lpserver <path>] [--lpcli <path>]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findLpcli,
  findLpServer,
  logicPilotRoot,
} from './tool-paths.mjs';

const root = logicPilotRoot();

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedLpServer() {
  const explicit = argument('--lpserver') ?? process.env.LP_SERVER;
  if (explicit) {
    assert.ok(existsSync(explicit), `lp-server does not exist: ${explicit}`);
    return explicit;
  }
  const discovered = findLpServer();
  if (discovered) return discovered;
  throw new Error('lp-server not found; pass --lpserver <path>');
}

function waitForPort(child, onGatewayPid = () => {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => {
      reject(new Error('timed out waiting for LOGICPILOT_PORT'));
    }, timeoutMs);

    const onData = (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/(?:^|\r?\n)LOGICPILOT_PORT (\d+)(?:\r?\n|$)/);
      if (!match) return;
      const gateway = buffered.match(/(?:^|\r?\n)LOGICPILOT_GATEWAY_PID (\d+)(?:\r?\n|$)/);
      if (gateway) onGatewayPid(Number(gateway[1]));
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`app server exited before startup (code ${code})`));
    });
  });
}

// True when the process with `pid` is no longer running (existence probe).
async function waitForProcessExit(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const lpcli = argument('--lpcli') ?? process.env.LPCLI ?? findLpcli();
assert.ok(lpcli && existsSync(lpcli), 'lpcli not found; pass --lpcli <path>');

const serverEnv = {
  ...process.env,
  LP_SERVER: selectedLpServer(),
  LPCLI: lpcli,
};
// Force the offline provider so the AI loop cannot depend on the network.
delete serverEnv.OPENAI_API_KEY;

const child = spawn(process.execPath, [join(root, 'app', 'server.mjs')], {
  cwd: root,
  env: serverEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  const port = await waitForPort(child);
  const baseUrl = `http://127.0.0.1:${port}`;

  const indexResponse = await fetch(`${baseUrl}/`);
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await indexResponse.text(), /<div id="root"><\/div>/);

  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.match(config.wsUrl, /^ws:\/\/127\.0\.0\.1:\d+\/sim$/);

  const buildResponse = await fetch(`${baseUrl}/api/ai-build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt:
          'build an M/M/1 queue model with arrival rate 0.8 and service ' +
          'rate 1.0',
      run: true,
    }),
  });
  assert.equal(buildResponse.status, 200);
  const result = await buildResponse.json();
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.provider, 'rule-based');
  assert.ok(Array.isArray(result.metrics?.blocks));
  assert.ok(result.metrics.blocks.some((block) => block.kind === 'queue'));
  assert.ok(result.metrics.blocks.some((block) => block.kind === 'service'));

  const patchResponse = await fetch(`${baseUrl}/api/ai-patch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'set server capacity to 3',
      model: {
        name: 'Queue',
        nodes: [{ id: 'server-id', kind: 'resource', name: 'Server', params: { capacity: 1 } }],
        edges: [],
      },
    }),
  });
  assert.equal(patchResponse.status, 200);
  const patchResult = await patchResponse.json();
  assert.deepEqual(patchResult.patch.operations, [
    { op: 'update_block', target: 'server-id', params: { capacity: 3 } },
  ]);

  const validateResponse = await fetch(`${baseUrl}/api/ai-validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl: result.dsl }),
  });
  assert.equal(validateResponse.status, 200);
  assert.equal((await validateResponse.json()).ok, true);

  const runResponse = await fetch(`${baseUrl}/api/ai-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl: result.dsl, reps: 1, arrivals: 100, warmup: 0 }),
  });
  assert.equal(runResponse.status, 200);
  const runResult = await runResponse.json();
  assert.equal(runResult.ok, true, JSON.stringify(runResult.diagnostics));
  assert.match(runResult.runSummary, /summary:/);
  assert.ok(runResult.metrics.blocks.some((block) => block.kind === 'queue'));

  const variationResponse = await fetch(`${baseUrl}/api/parameter-variation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dsl: readFileSync(join(root, 'examples', 'des-parameter-variation.lp'), 'utf8'),
      experimentName: 'CapacityStudy',
      arrivals: 300,
      warmup: 30,
      concurrency: 2,
    }),
  });
  assert.equal(variationResponse.status, 200);
  const variation = await variationResponse.json();
  assert.equal(variation.ok, true);
  assert.equal(variation.kind, 'parameter_variation');
  assert.equal(variation.pointCount, 4);

  const queryResponse = await fetch(`${baseUrl}/api/ai-query-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'where is the bottleneck?', metrics: runResult.metrics }),
  });
  assert.equal(queryResponse.status, 200);
  const queryResult = await queryResponse.json();
  assert.equal(queryResult.kind, 'metric-query');
  assert.ok(queryResult.findings.length > 0);

  const compareResponse = await fetch(`${baseUrl}/api/ai-compare-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ before: result.metrics, after: runResult.metrics }),
  });
  assert.equal(compareResponse.status, 200);
  const compareResult = await compareResponse.json();
  assert.equal(compareResult.kind, 'metric-comparison');
  assert.ok(compareResult.findings.length > 0);

  // Crash cleanup: a hard-killed app server (simulating a crashed Tauri
  // shell) must not leave the lp-server gateway orphaned. lp-server runs its
  // own parent-process watchdog and exits when the parent dies.
  {
    let gatewayPid = 0;
    const crashChild = spawn(
        process.execPath, [join(root, 'app', 'server.mjs')],
        {
          cwd: root,
          env: serverEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
    );
    let crashStderr = '';
    crashChild.stderr.on('data', (chunk) => { crashStderr += chunk.toString(); });
    try {
      const crashPort = await waitForPort(
          crashChild, (pid) => { gatewayPid = pid; }, 20_000);
      assert.ok(gatewayPid > 0, 'app server must report the gateway pid');
      const crashBase = `http://127.0.0.1:${crashPort}`;
      const alive = await fetch(`${crashBase}/api/config`)
          .then((response) => response.ok)
          .catch(() => false);
      assert.ok(alive, 'gateway must be serving before the crash');
      crashChild.kill('SIGKILL');  // no graceful shutdown path runs
      const exited = await waitForProcessExit(gatewayPid, 10_000);
      assert.ok(exited, `gateway pid ${gatewayPid} survived its parent's crash`);
    } catch (error) {
      if (crashStderr.trim()) process.stderr.write(crashStderr);
      throw error;
    } finally {
      try { crashChild.kill(); } catch { /* already gone */ }
    }
  }

  console.log('APP-SERVER TEST: PASS');
} catch (error) {
  if (stderr.trim()) process.stderr.write(stderr);
  throw error;
} finally {
  child.kill();
}
