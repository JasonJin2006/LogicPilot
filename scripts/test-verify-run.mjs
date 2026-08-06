#!/usr/bin/env node
// CI smoke for the runtime verifier (P1): lpcli run on examples/mm1.lp ->
// verify-run.mjs against mm1.expect.json must pass, and a broken metrics
// file must fail. Requires node (available in the kernel CI job).
//
// Usage: node scripts/test-verify-run.mjs [--lpcli <path>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const flag = process.argv.indexOf('--lpcli');
const lpcli = flag >= 0 ? process.argv[flag + 1] : 'lpcli';
const node = process.execPath;

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

function verify(metricsPath, expectPath) {
  try {
    run(node, [join(here, 'verify-run.mjs'), metricsPath, expectPath]);
    return true;
  } catch {
    return false;
  }
}

const dir = mkdtempSync(join(tmpdir(), 'verify-run-'));
let passed = false;
try {
  const mm1 = join(root, 'examples', 'mm1.lp');
  const expect = join(root, 'examples', 'mm1.expect.json');
  const ir = join(dir, 'mm1.ir.bin');
  const results = join(dir, 'results');

  run(lpcli, ['compile', mm1, '-o', ir]);
  run(lpcli, [
    'run', '--model-file', ir,
    '--seed', '42',
    '--reps', '2',
    '--arrivals', '500',
    '--warmup', '50',
    '--results-dir', results,
  ]);
  const metricsPath = join(results, 'metrics.json');
  if (!existsSync(metricsPath)) {
    throw new Error('lpcli run did not produce metrics.json');
  }

  // Real mm1 run must pass the invariant + theory checks.
  if (!verify(metricsPath, expect)) {
    throw new Error('verifier rejected a valid mm1 run');
  }

  // A broken metrics file (departures > arrivals) must fail conservation.
  const broken = join(dir, 'broken.json');
  writeFileSync(
    broken,
    JSON.stringify({
      summary: {
        throughput: { mean: 1 },
        Wq: { mean: 0.1 },
      },
      replications: [{ rep: 1, arrivals: 10, departures: 99 }],
    }),
    'utf8',
  );
  if (verify(broken, expect)) {
    throw new Error('verifier accepted departures > arrivals');
  }

  passed = true;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!passed) {
  console.error('VERIFY-RUN TEST: FAIL');
  process.exit(1);
}
console.log('VERIFY-RUN TEST: PASS');
