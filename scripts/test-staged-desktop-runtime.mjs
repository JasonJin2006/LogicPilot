// Hermetic runtime smoke: start the staged Node + app server + native
// sidecars with no repository build directories or machine Node on PATH.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { execFileAsync } from './subprocess-supervisor.mjs';

const flag = process.argv.indexOf('--stage');
const stage = resolve(
  flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1] : 'build/desktop-runtime',
);
const executable = (name) => join(stage, 'runtime', name);
const node = executable(join('node', process.platform === 'win32' ? 'node.exe' : 'node'));
const lpcli = executable(join('bin', process.platform === 'win32' ? 'lpcli.exe' : 'lpcli'));
const lpserver = executable(
  join('bin', process.platform === 'win32' ? 'lp-server.exe' : 'lp-server'),
);
const componentRunner = executable(
  join(
    'bin',
    process.platform === 'win32'
      ? 'logicpilot-component-runner.exe'
      : 'logicpilot-component-runner',
  ),
);

function readExecutionWebSocketSnapshot(port, token, runId) {
  return new Promise((resolveSnapshot, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const key = randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0);
    let headerEnd = -1;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(10_000, () => fail(new Error('execution websocket timed out')));
    socket.on('error', fail);
    socket.on('connect', () => {
      socket.write(
        `GET /api/execution/events?runId=${encodeURIComponent(runId)}&token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
          'Host: 127.0.0.1:' +
          port +
          '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' +
          key +
          '\r\n\r\n',
      );
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (headerEnd < 0) {
        headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!/^HTTP\/1\.1 101 /m.test(header)) {
          fail(new Error(`execution websocket handshake failed: ${header}`));
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
      }
      if (buffer.length < 2) return;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      if (length === 127 || buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length).toString('utf8');
      settled = true;
      socket.end();
      resolveSnapshot(JSON.parse(payload));
    });
  });
}

async function lpcliRunning() {
  try {
    const result = await execFileAsync({
      command: 'tasklist',
      args: ['/FI', 'IMAGENAME eq lpcli.exe'],
      timeoutMs: 5_000,
    });
    return /lpcli\.exe/i.test(result.stdout);
  } catch {
    // Ambiguous (e.g. tasklist unavailable): report "still running" so the
    // test fails loudly instead of silently passing.
    return true;
  }
}

async function waitForLpcliGone(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await lpcliRunning())) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
for (const path of [node, lpcli, lpserver, componentRunner, join(stage, 'app', 'server.mjs')]) {
  assert.ok(existsSync(path), `staged runtime file missing: ${path}`);
}
// The staged Wasmtime runner must actually run and reject a non-component
// payload with a clear error instead of hanging or crashing the host. This is
// the only gate exercising the real binary end to end until a compiled
// component fixture exists.
{
  const garbage = join(stage, 'component-smoke.not-wasm');
  writeFileSync(garbage, 'not a webassembly component', 'utf8');
  try {
    const result = spawnSync(componentRunner, [garbage, '--max-memory-bytes', '65536'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0, 'runner accepted a non-component payload');
    assert.match(
      result.stderr,
      /cannot load component/,
      'runner must fail with a load error, got: ' + result.stderr.slice(0, 200),
    );
  } finally {
    unlinkSync(garbage);
  }
}
const manifest = JSON.parse(readFileSync(join(stage, 'runtime-manifest.json'), 'utf8'));
assert.equal(manifest.format, 1);
assert.equal(manifest.platform, process.platform);
assert.equal(manifest.architecture, process.arch);
assert.ok(manifest.files.length > 10);
assert.match(manifest.nodeVersion, /^v(?:2\d|[3-9]\d)\./);
for (const entry of manifest.files) {
  assert.equal(typeof entry.path, 'string');
  const file = resolve(stage, entry.path);
  const fromStage = relative(stage, file);
  assert.ok(
    fromStage && !fromStage.startsWith('..') && !isAbsolute(fromStage),
    `manifest path escapes stage: ${entry.path}`,
  );
  assert.ok(existsSync(file), `manifest file missing: ${entry.path}`);
  const content = readFileSync(file);
  assert.equal(content.byteLength, entry.bytes, `manifest size mismatch: ${entry.path}`);
  assert.equal(
    createHash('sha256').update(content).digest('hex'),
    entry.sha256,
    `manifest hash mismatch: ${entry.path}`,
  );
}

const systemPath =
  process.platform === 'win32'
    ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env.SystemRoot ?? 'C:\\Windows'}`
    : '/usr/bin:/bin';
const child = spawn(node, [join(stage, 'app', 'server.mjs')], {
  cwd: stage,
  env: {
    ...process.env,
    LOGICPILOT_ROOT: stage,
    LPCLI: lpcli,
    LP_SERVER: lpserver,
    LOGICPILOT_ENABLE_NODE_PLUGINS: '1',
    LOGICPILOT_ENABLE_NATIVE_SESSION_HOST: '1',
    LOGICPILOT_NODE_PLUGIN_TRUST: 't4',
    LOGICPILOT_PLUGIN_STORE_ROOT: join(stage, 'plugin-store'),
    LOGICPILOT_SESSION_HOST: join(
      stage,
      'runtime',
      'bin',
      process.platform === 'win32' ? 'lp-session-host.exe' : 'lp-session-host',
    ),
    LOGICPILOT_PLUGIN_ROOTS: JSON.stringify({
      system: [join(stage, 'plugins', 'runtime')],
      user: [],
      workspace: [],
    }),
    PATH: `${join(stage, 'runtime', 'bin')}${process.platform === 'win32' ? ';' : ':'}${systemPath}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
let gatewayReported = false;
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
const port = await new Promise((resolvePort, reject) => {
  let stdout = '';
  const timeout = setTimeout(
    () => reject(new Error('staged app server startup timed out')),
    20_000,
  );
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const match = stdout.match(/LOGICPILOT_PORT (\d+)/);
    if (/LOGICPILOT_WS_PORT \d+/.test(stdout)) gatewayReported = true;
    const token = stdout.match(/LOGICPILOT_SESSION_TOKEN ([A-Za-z0-9_-]+)/);
    if (match && token) {
      clearTimeout(timeout);
      resolvePort({ port: Number(match[1]), sessionToken: token[1] });
    }
  });
  child.once('exit', (code) => {
    clearTimeout(timeout);
    reject(new Error(`staged app server exited (${code}): ${stderr}`));
  });
});

try {
  const base = `http://127.0.0.1:${port.port}`;
  assert.equal(gatewayReported, false, 'native-only staged app must not start legacy gateway');
  assert.equal((await fetch(`${base}/`)).status, 200);
  const build = await fetch(`${base}/api/ai-build`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
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
  const targets = await fetch(`${base}/api/execution`, {
    headers: { 'x-logicpilot-session': port.sessionToken },
  });
  assert.equal(targets.status, 200);
  const targetPayload = await targets.json();
  const modernTargets = await fetch(`${base}/api/execution/targets`, {
    headers: { 'x-logicpilot-session': port.sessionToken },
  });
  assert.equal(modernTargets.status, 200);
  assert.deepEqual((await modernTargets.json()).targets, targetPayload.targets);
  for (const [id, pluginId] of [
    ['logicpilot.process.runtime', 'logicpilot.runtime.process'],
    ['logicpilot.devs.runtime', 'logicpilot.runtime.devs'],
    ['logicpilot.continuous.runtime', 'logicpilot.runtime.continuous'],
    ['logicpilot.agent.runtime', 'logicpilot.runtime.agent'],
    ['logicpilot.generic.runtime', 'logicpilot.runtime.generic'],
  ]) {
    const target = targetPayload.targets.find((candidate) => candidate.id === id);
    assert.ok(target, `missing target ${id}`);
    assert.equal(target.runtime.pluginId, pluginId);
  }
  const mm1Dsl = `model MM1 {
    use process
    param arrival_rate: float = 0.8
    param service_rate: float = 1.0
    resource Server { capacity = 1 }
    source Arrivals { arrival = rate(arrival_rate) }
    queue WaitLine { capacity = 1000000 }
    service Handle { resource = Server time = exponential(service_rate) }
    sink Done { }
    couple Arrivals.out -> WaitLine.in
    couple WaitLine.out -> Handle.in
    couple Handle.out -> Done.in
  }`;
  const started = await fetch(`${base}/api/execution/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      targetId: 'logicpilot.process.runtime',
      requestId: 'staged-session-start',
      seed: 46,
      inputs: { paradigm: 'process', dsl: mm1Dsl },
    }),
  });
  assert.equal(started.status, 202);
  const startedPayload = await started.json();
  const startedRunId = startedPayload.session.runId;
  assert.equal(startedPayload.session.requestId, 'staged-session-start');
  let startedSession;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await fetch(
      `${base}/api/execution/runs/${encodeURIComponent(startedRunId)}`,
      { headers: { 'x-logicpilot-session': port.sessionToken } },
    );
    assert.equal(snapshot.status, 200);
    startedSession = (await snapshot.json()).session;
    if (startedSession.status === 'completed' || startedSession.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(startedSession.status, 'completed', JSON.stringify(startedSession));
  assert.equal(
    JSON.parse(
      readFileSync(
        join(stage, 'plugin-store', 'execution-runs', 'execution-sessions.json'),
        'utf8',
      ),
    ).sessions.find((session) => session.runId === startedRunId)?.status,
    'completed',
  );
  const streamSnapshot = await readExecutionWebSocketSnapshot(
    port.port,
    port.sessionToken,
    startedRunId,
  );
  assert.equal(streamSnapshot.runId, startedRunId);
  assert.deepEqual(
    streamSnapshot.events.map((event) => event.kind),
    ['state', 'terminal'],
  );
  const nativeStarted = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'start',
      targetId: 'logicpilot.native.session',
      requestId: 'staged-native-session',
      seed: 48,
      inputs: { paradigm: 'process', dsl: mm1Dsl, executionMode: 'fast' },
    }),
  });
  assert.equal(nativeStarted.status, 202);
  const nativeSession = await nativeStarted.json();
  let nativeSnapshot;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await fetch(
      `${base}/api/execution?runId=${encodeURIComponent(nativeSession.session.runId)}`,
      { headers: { 'x-logicpilot-session': port.sessionToken } },
    );
    assert.equal(snapshot.status, 200);
    nativeSnapshot = (await snapshot.json()).session;
    if (nativeSnapshot.status === 'completed' || nativeSnapshot.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(nativeSnapshot.status, 'completed', JSON.stringify(nativeSnapshot));
  const multimethodDsl = readFileSync(
    join(process.cwd(), 'examples', 'cases', 'multimethod', 'smart_factory.lp'),
    'utf8',
  );
  const mixedNative = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'start',
      targetId: 'logicpilot.native.session',
      requestId: 'staged-native-multimethod',
      seed: 50,
      inputs: { paradigm: 'process', dsl: multimethodDsl, executionMode: 'fast' },
    }),
  });
  assert.equal(mixedNative.status, 202);
  const mixedSession = await mixedNative.json();
  let mixedSnapshot;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await fetch(
      `${base}/api/execution?runId=${encodeURIComponent(mixedSession.session.runId)}`,
      { headers: { 'x-logicpilot-session': port.sessionToken } },
    );
    assert.equal(snapshot.status, 200);
    mixedSnapshot = (await snapshot.json()).session;
    if (mixedSnapshot.status === 'completed' || mixedSnapshot.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(mixedSnapshot.status, 'completed', JSON.stringify(mixedSnapshot));
  const animatedNative = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'start',
      targetId: 'logicpilot.native.session',
      requestId: 'staged-native-animated',
      seed: 49,
      inputs: { paradigm: 'process', dsl: mm1Dsl, executionMode: 'animated', autoFinish: false },
    }),
  });
  assert.equal(animatedNative.status, 202);
  const animatedSession = await animatedNative.json();
  const animatedQuery = async () => {
    const response = await fetch(
      `${base}/api/execution?runId=${encodeURIComponent(animatedSession.session.runId)}`,
      { headers: { 'x-logicpilot-session': port.sessionToken } },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const beforeStep = await animatedQuery();
  const pauseResponse = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'command',
      command: {
        schema: 'logicpilot.execution-command/v1',
        contractVersion: 1,
        commandId: 'native-pause-1',
        runId: animatedSession.session.runId,
        action: 'pause',
        expectedStateVersion: beforeStep.session.stateVersion,
      },
    }),
  });
  assert.equal(pauseResponse.status, 200);
  assert.equal((await pauseResponse.json()).accepted, true);
  const pausedSnapshot = await animatedQuery();
  assert.equal(pausedSnapshot.session.status, 'paused');
  const stepResponse = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'command',
      command: {
        schema: 'logicpilot.execution-command/v1',
        contractVersion: 1,
        commandId: 'native-step-1',
        runId: animatedSession.session.runId,
        action: 'step',
        expectedStateVersion: pausedSnapshot.session.stateVersion,
      },
    }),
  });
  assert.equal(stepResponse.status, 200);
  assert.equal((await stepResponse.json()).accepted, true);
  const afterStep = await animatedQuery();
  assert.ok(
    afterStep.events.some((event) => event.kind === 'telemetry'),
    JSON.stringify(afterStep),
  );
  const resumeResponse = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'command',
      command: {
        schema: 'logicpilot.execution-command/v1',
        contractVersion: 1,
        commandId: 'native-resume-1',
        runId: animatedSession.session.runId,
        action: 'resume',
        expectedStateVersion: afterStep.session.stateVersion,
      },
    }),
  });
  assert.equal(resumeResponse.status, 200);
  assert.equal((await resumeResponse.json()).accepted, true);
  const resumedSnapshot = await animatedQuery();
  assert.equal(resumedSnapshot.session.status, 'running');
  const stopResponse = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'command',
      command: {
        schema: 'logicpilot.execution-command/v1',
        contractVersion: 1,
        commandId: 'native-stop-1',
        runId: animatedSession.session.runId,
        action: 'stop',
        expectedStateVersion: resumedSnapshot.session.stateVersion,
      },
    }),
  });
  const stopPayload = await stopResponse.json();
  assert.equal(stopResponse.status, 200, JSON.stringify(stopPayload));
  assert.equal(stopPayload.accepted, true, JSON.stringify(stopPayload));
  const execution = await fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'execute',
      targetId: 'logicpilot.process.runtime',
      requestId: 'staged-execution',
      seed: 47,
      inputs: {
        paradigm: 'process',
        dsl: mm1Dsl,
      },
    }),
  });
  assert.equal(execution.status, 200);
  const executionResult = await execution.json();
  assert.equal(executionResult.run.targetId, 'logicpilot.process.runtime');
  assert.equal(executionResult.run.status, 'completed');
  assert.equal(executionResult.run.seed, 47);
  assert.ok(executionResult.evidence?.runId === executionResult.run.runId);
  assert.equal(executionResult.evidence?.runtimeKind, 'process');
  assert.equal(executionResult.evidence?.method, 'process');
  assert.equal(executionResult.evidence?.conformance?.passed, true);
  assert.equal(executionResult.evidence?.conformance?.checks?.utilizationValid, true);
  const familyCases = [
    {
      targetId: 'logicpilot.devs.runtime',
      paradigm: 'devs',
      dsl: `model AtomicTimer {
        atomic Timer {
          time_advance = constant(1.0)
          on_timeout { emit tick }
        }
      }`,
    },
    {
      targetId: 'logicpilot.continuous.runtime',
      paradigm: 'continuous',
      dsl: `model Decay {
        continuous Dynamics {
          state y = 1.0
          param k = 0.5
          d y/dt = -k*y
        }
      }`,
    },
    {
      targetId: 'logicpilot.agent.runtime',
      paradigm: 'agent',
      dsl: `model AgentSwarm {
        agent Drone {
          count = 3
          state active = true
          on_tick { flip active }
          on_tick { bounce }
        }
      }`,
    },
  ];
  for (const [index, { targetId, paradigm, dsl }] of familyCases.entries()) {
    const familyExecution = await fetch(`${base}/api/execution`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-logicpilot-session': port.sessionToken,
      },
      body: JSON.stringify({
        action: 'execute',
        targetId,
        requestId: `staged-${index + 2}`,
        inputs: {
          paradigm,
          dsl,
          runParams: { arrivals: 10, warmup: 0 },
        },
      }),
    });
    assert.equal(familyExecution.status, 200);
    const familyResult = await familyExecution.json();
    assert.equal(familyResult.run.targetId, targetId);
    assert.equal(familyResult.run.status, 'completed');
    assert.equal(familyResult.evidence?.runId, familyResult.run.runId);
    assert.equal(familyResult.evidence?.runtimeKind, paradigm);
    assert.equal(familyResult.evidence?.conformance?.passed, true);
    if (paradigm === 'agent') {
      assert.ok(familyResult.evidence?.details?.summary?.logicalTraceBytes > 0);
      assert.match(
        familyResult.evidence?.details?.summary?.logicalTraceDigest ?? '',
        /^[a-f0-9]{64}$/,
      );
      assert.equal(familyResult.evidence?.conformance?.checks?.replayDeterministic, true);
    }
    if (paradigm === 'devs') {
      assert.equal(
        familyResult.evidence?.details?.summary?.traceStatus,
        'transition-trace-not-exported',
      );
      assert.equal(familyResult.evidence?.conformance?.checks?.replayDeterministic, true);
    }
    if (paradigm === 'continuous') {
      assert.equal(familyResult.evidence?.conformance?.checks?.trajectoryValid, true);
      const final = familyResult.evidence.details.summary.finalValues[0];
      // This known fixture is y'= -0.5*y, ten 0.01-second integration steps.
      assert.ok(Math.abs(final - Math.exp(-0.05)) < 1e-6);
    }
  }
  // The kernel service must keep the event loop responsive: while a long
  // execution runs, a concurrent heartbeat is served immediately, and the
  // heavy request settles as a reclaimed (deadline-expired) failed run
  // instead of hanging the whole server.
  const heavy = fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'execute',
      targetId: 'logicpilot.process.runtime',
      requestId: 'staged-heavy-deadline',
      seed: 91,
      budget: { maxWallMs: 1200 },
      inputs: {
        paradigm: 'process',
        // No machine simulates 100M arrivals before a 1.2s wall budget; the
        // kernel run phase is guaranteed to hit the deadline and be reclaimed.
        dsl: mm1Dsl,
        runParams: { arrivals: 100_000_000, warmup: 0 },
      },
    }),
  });
  for (let i = 0; i < 2; i += 1) {
    const at = Date.now();
    const pong = await fetch(`${base}/`);
    const latency = Date.now() - at;
    assert.equal(pong.status, 200);
    assert.ok(latency < 1_000, `heartbeat was blocked for ${latency}ms during execution`);
  }
  const heavyResult = await heavy;
  assert.equal(heavyResult.status, 200);
  const heavyPayload = await heavyResult.json();
  assert.equal(heavyPayload.run.requestId, 'staged-heavy-deadline');
  assert.equal(heavyPayload.run.status, 'failed');
  assert.match(heavyPayload.run.error ?? '', /RT0005/);
  // Ensure the deadline-reclaimed lpcli is fully reaped before the next
  // segment asserts on process state, so its tasklist poll is not racing a
  // lingering process from this run.
  assert.equal(
    await waitForLpcliGone(8_000),
    true,
    'deadline execution left an lpcli process running',
  );
  // A client disconnect must cancel the in-flight run: the kernel subprocess
  // tree is reclaimed long before the 30s wall budget expires.
  const cancelledClient = new AbortController();
  const abortedHeavy = fetch(`${base}/api/execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-logicpilot-session': port.sessionToken,
    },
    body: JSON.stringify({
      action: 'execute',
      targetId: 'logicpilot.process.runtime',
      requestId: 'staged-heavy-abort',
      seed: 92,
      budget: { maxWallMs: 30_000 },
      inputs: {
        paradigm: 'process',
        dsl: mm1Dsl,
        runParams: { arrivals: 100_000_000, warmup: 0 },
      },
    }),
    signal: cancelledClient.signal,
  }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1_500)); // well inside the run phase
  cancelledClient.abort();
  await abortedHeavy;
  assert.equal(
    await waitForLpcliGone(10_000),
    true,
    'cancelled execution left an lpcli process running',
  );
  assert.equal((await fetch(`${base}/`)).status, 200);
  console.log('STAGED-DESKTOP-RUNTIME TEST: PASS');
} finally {
  child.kill();
}
