import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRuntimeModel, runtimeAdapterIds } from './runtime-adapters.mjs';

const cases = {
  process: 'examples/mm1.lp',
  devs: 'examples/cases/devs/timer.lp',
  continuous: 'examples/decay.lp',
  agent: 'examples/agents.lp',
};

assert.deepEqual(runtimeAdapterIds(), ['process', 'devs', 'continuous', 'agent']);
for (const [runtimeKind, path] of Object.entries(cases)) {
  const result = await runRuntimeModel({
    runtimeKind,
    dsl: readFileSync(path, 'utf8'),
    runParams: { arrivals: 5, warmup: 0, reps: 1 },
  });
  assert.equal(result.ok, true, `${runtimeKind} adapter rejected ${path}`);
  assert.ok(result.metrics?.replications?.length > 0);
  if (runtimeKind === 'continuous') assert.ok(result.trajectory?.points?.length > 0);
}

const rejected = await runRuntimeModel({
  runtimeKind: 'agent',
  dsl: readFileSync(cases.process, 'utf8'),
});
assert.equal(rejected.ok, false);
assert.equal(rejected.diagnostics[0].code, 'RT0001');
assert.equal(rejected.runSummary, ''); // IR mismatch rejected before execution.
const repeated = await runRuntimeModel({
  runtimeKind: 'agent',
  dsl: readFileSync(cases.agent, 'utf8'),
  replayCheck: true,
  runParams: { seed: 73, arrivals: 5, warmup: 0, reps: 2 },
});
assert.equal(repeated.ok, true);
assert.equal(repeated.experiment.seed, 73);
assert.equal(repeated.metrics.replications.length, 2);
assert.equal(repeated.conformance.checks.replayDeterministic, true);

// A pre-aborted cancellation signal must stop the run without spawning lpcli.
const cancelled = new AbortController();
cancelled.abort();
const aborted = await runRuntimeModel({
  runtimeKind: 'process',
  dsl: readFileSync(cases.process, 'utf8'),
  runParams: { arrivals: 5, warmup: 0, reps: 1 },
  signal: cancelled.signal,
});
assert.equal(aborted.ok, false);
assert.equal(aborted.diagnostics[0].code, 'RT0005');
console.log('RUNTIME-ADAPTERS TEST: PASS');
