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

  // Deterministic block-level DES conformance: this proves the complete
  // DSL -> IR -> runtime -> structured metrics path, including Service's
  // numberOfUnits resource requirement.
  const conformance = join(root, 'examples', 'des-core-conformance.lp');
  const conformanceExpect = join(
    root,
    'examples',
    'des-core-conformance.expect.json',
  );
  const conformanceIr = join(dir, 'des-core-conformance.ir.bin');
  const conformanceResults = join(dir, 'des-core-results');
  run(lpcli, ['compile', conformance, '-o', conformanceIr]);
  run(lpcli, [
    'run', '--model-file', conformanceIr,
    '--seed', '42',
    '--reps', '1',
    '--arrivals', '100',
    '--warmup', '0',
    '--results-dir', conformanceResults,
  ]);
  if (!verify(join(conformanceResults, 'metrics.json'), conformanceExpect)) {
    throw new Error('verifier rejected DES core block metrics');
  }

  const shared = join(root, 'examples', 'des-shared-resource.lp');
  const sharedExpect = join(
    root,
    'examples',
    'des-shared-resource.expect.json',
  );
  const sharedIr = join(dir, 'des-shared-resource.ir.bin');
  const sharedResults = join(dir, 'des-shared-results');
  run(lpcli, ['compile', shared, '-o', sharedIr]);
  run(lpcli, [
    'run', '--model-file', sharedIr,
    '--seed', '42',
    '--reps', '1',
    '--arrivals', '100',
    '--warmup', '0',
    '--results-dir', sharedResults,
  ]);
  if (!verify(join(sharedResults, 'metrics.json'), sharedExpect)) {
    throw new Error('verifier rejected shared ResourcePool arbitration');
  }

  const queue = join(root, 'examples', 'des-queue-timeout-preempt.lp');
  const queueExpect = join(
    root,
    'examples',
    'des-queue-timeout-preempt.expect.json',
  );
  const queueIr = join(dir, 'des-queue-timeout-preempt.ir.bin');
  const queueResults = join(dir, 'des-queue-results');
  run(lpcli, ['compile', queue, '-o', queueIr]);
  run(lpcli, [
    'run', '--model-file', queueIr,
    '--seed', '42',
    '--reps', '1',
    '--arrivals', '100',
    '--warmup', '0',
    '--results-dir', queueResults,
  ]);
  if (!verify(join(queueResults, 'metrics.json'), queueExpect)) {
    throw new Error('verifier rejected Queue timeout/preemption semantics');
  }

  // Queue order must remain observable across the complete pipeline. Both
  // models use the same arrivals; only FIFO/LIFO differs, so a swapped sink
  // count catches either ignored configuration or incorrect ordering.
  for (const order of ['fifo', 'lifo']) {
    const modelName = `des-queue-${order}`;
    const model = join(root, 'examples', `${modelName}.lp`);
    const modelExpect = join(root, 'examples', `${modelName}.expect.json`);
    const modelIr = join(dir, `${modelName}.ir.bin`);
    const modelResults = join(dir, `${modelName}-results`);
    run(lpcli, ['compile', model, '-o', modelIr]);
    run(lpcli, [
      'run', '--model-file', modelIr,
      '--seed', '42',
      '--reps', '1',
      '--arrivals', '100',
      '--warmup', '0',
      '--results-dir', modelResults,
    ]);
    if (!verify(join(modelResults, 'metrics.json'), modelExpect)) {
      throw new Error(`verifier rejected Queue ${order.toUpperCase()} semantics`);
    }
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
