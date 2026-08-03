#!/usr/bin/env node
// Headless integration check for the browser visualization slice.
//
// Connects to the lp-server gateway with the exact same transport + decode
// path the browser uses (native WebSocket -> size-prefixed LPWR FlatBuffer
// -> @logicpilot/renderer2d decodeWireFrame), sends a short run and prints
// a frame tally plus the RunFinished stats for comparison against
// examples/mm1.expect.json (theory: Wq=4.0, W=5.0, throughput=0.8).
//
// Usage: node web/apps/ide/scripts/headless-verify.mjs [ws-url]
//        (default ws://127.0.0.1:8089/sim)

import { decodeWireFrame } from '@logicpilot/renderer2d';

const url = process.argv[2] ?? 'ws://127.0.0.1:8089/sim';
const counts = { 'run-started': 0, tick: 0, counters: 0, 'run-finished': 0 };
let badFrames = 0;
let textAcks = [];
let maxAgents = 0;
let lastSeq = null;
let seqMonotonic = true;
let finished = null;

const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';
const startedAt = Date.now();
const progress = setInterval(() => {
  const total = counts.tick + counts.counters + counts['run-started'] + counts['run-finished'];
  console.log(
    `[verify] ... ${((Date.now() - startedAt) / 1000).toFixed(0)}s, frames=${total} ` +
      `(tick=${counts.tick}, counters=${counts.counters})`,
  );
}, 5000);
const timeout = setTimeout(() => {
  console.error('[verify] TIMEOUT waiting for RunFinished');
  process.exit(1);
}, 180_000);

ws.addEventListener('open', () => {
  console.log(`[verify] connected to ${url}`);
  ws.send(
    // Small run for fast turnaround; the gateway streams every 0.1 sim-time
    // slice, so frame volume scales with arrivals.
    JSON.stringify({ cmd: 'start', seed: 42, reps: 3, arrivals: 200, warmup: 30, speed: 50 }),
  );
});

ws.addEventListener('message', (ev) => {
  if (typeof ev.data === 'string') {
    textAcks.push(ev.data);
    return;
  }
  const frame = decodeWireFrame(new Uint8Array(ev.data));
  if (frame === null) {
    badFrames += 1;
    return;
  }
  counts[frame.kind] += 1;
  if (lastSeq !== null && frame.seq <= lastSeq) seqMonotonic = false;
  lastSeq = frame.seq;
  if (frame.kind === 'tick') {
    maxAgents = Math.max(maxAgents, frame.payload.deltas.length);
  } else if (frame.kind === 'run-finished') {
    finished = frame.payload;
    clearInterval(progress);
    clearTimeout(timeout);
    ws.close();
  }
});

ws.addEventListener('close', () => {
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[verify] closed after ${seconds}s wall time`);
  console.log(`[verify] acks: ${textAcks.join(' | ')}`);
  console.log(
    `[verify] frames: RunStarted=${counts['run-started']} Tick=${counts.tick} ` +
      `Counters=${counts.counters} RunFinished=${counts['run-finished']} bad=${badFrames}`,
  );
  console.log(`[verify] seq monotonic=${seqMonotonic} max agents in flight=${maxAgents}`);
  if (!finished) {
    console.error('[verify] FAIL: no RunFinished frame');
    process.exit(1);
  }
  console.log(`[verify] status=${finished.statusName} run=${finished.runId}`);
  const stats = finished.stats;
  for (const key of Object.keys(stats).sort()) {
    console.log(`[verify] stat ${key} = ${stats[key]}`);
  }
  const wq = stats['Wq.mean'];
  const throughput = stats['throughput.mean'];
  const ok =
    finished.statusName === 'Completed' &&
    badFrames === 0 &&
    seqMonotonic &&
    counts['run-started'] >= 1 &&
    counts.tick > 10 &&
    counts.counters > 10 &&
    // Theory (examples/mm1.expect.json): Wq=4.0, throughput=0.8. The small
    // verification sample (200 arrivals x 3 reps) is noisy, so accept the
    // wide band here; strict acceptance lives in the kernel test suite.
    typeof wq === 'number' &&
    wq > 1.0 &&
    wq < 9.0 &&
    typeof throughput === 'number' &&
    Math.abs(throughput - 0.8) < 0.2;
  console.log(ok ? '[verify] PASS' : '[verify] FAIL: stats outside mm1.expect.json band');
  process.exit(ok ? 0 : 1);
});

ws.addEventListener('error', () => {
  console.error('[verify] websocket error');
  process.exit(1);
});
