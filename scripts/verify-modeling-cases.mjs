// Executable modeling-case matrix: compile every case, run it through the
// real kernel, and check paradigm-specific scientific invariants. This is a
// product acceptance gate, not a syntax-only example linter.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { findLpcli, logicPilotRoot } from './tool-paths.mjs';

const ROOT = logicPilotRoot();
const DEFAULT_SEED = 42;

function closeTo(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

function bounded(value, low, high, label) {
  assert.ok(value >= low && value <= high, `${label}: expected [${low}, ${high}], got ${value}`);
}

function firstReplication(metrics) {
  assert.ok(Array.isArray(metrics.replications) && metrics.replications.length > 0);
  return metrics.replications[0];
}

function method(metrics, name) {
  assert.equal(metrics.mode, 'multi-method');
  const entry = metrics.methods?.find((candidate) => candidate.name === name);
  assert.ok(entry, `missing method '${name}'`);
  assert.ok(entry.replications.length > 0, `method '${name}' has no replication metrics`);
  return entry.replications[0];
}

export const MODELING_CASES = Object.freeze([
  {
    id: 'process-1-mm1',
    paradigm: 'process',
    level: 1,
    source: 'examples/mm1.lp',
    run: ['--reps=5', '--arrivals=5000', '--warmup=500'],
    verify: ({ metrics }) => {
      const summary = metrics.summary;
      bounded(summary.utilization.mean, 0.70, 0.90, 'M/M/1 utilization');
      bounded(summary.Wq.mean, 2.5, 5.5, 'M/M/1 Wq');
      for (const replication of metrics.replications) assert.equal(replication.departures, 5000);
      return { Wq: summary.Wq.mean, utilization: summary.utilization.mean };
    },
  },
  {
    id: 'process-2-shared-resource',
    paradigm: 'process',
    level: 2,
    source: 'examples/des-shared-resource.lp',
    run: ['--reps=1', '--arrivals=60', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.departures, 2);
      closeTo(replication.horizon_seconds, 2, 1e-12, 'shared-resource horizon');
      closeTo(replication.utilization, 1, 1e-12, 'shared-resource utilization');
      return { departures: 2, horizon: replication.horizon_seconds };
    },
  },
  {
    id: 'process-3-shop',
    paradigm: 'process',
    level: 3,
    source: 'examples/des_shop.lp',
    run: ['--reps=1', '--arrivals=60', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.departures, 60);
      bounded(replication.utilization, 0, 1, 'complex shop utilization');
      closeTo(replication.measure, 0.5, 1e-12, 'complex shop measured finish time');
      const batch = metrics.blocks.find((block) => block.name === 'Group');
      assert.equal(batch?.arrived_mean, 60);
      assert.equal(batch?.departed_mean, 30);
      return { utilization: replication.utilization, batches: batch.departed_mean };
    },
  },
  {
    id: 'agent-1-swarm',
    paradigm: 'agent',
    level: 1,
    source: 'examples/agents.lp',
    run: ['--reps=1', '--arrivals=5', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.arrivals, 5);
      closeTo(replication.horizon_seconds, 5, 1e-12, 'swarm tick horizon');
      return { ticks: replication.arrivals, horizon: replication.horizon_seconds };
    },
  },
  {
    id: 'agent-2-embedded-flow',
    paradigm: 'agent',
    level: 2,
    source: 'examples/agent_body_mm1.lp',
    run: ['--reps=1', '--arrivals=200', '--warmup=20'],
    verify: ({ metrics }) => {
      const agent = method(metrics, 'agent');
      const process = method(metrics, 'process');
      assert.equal(agent.arrivals, 200);
      assert.equal(process.departures, 200);
      return { agentTicks: agent.arrivals, processDepartures: process.departures };
    },
  },
  {
    id: 'agent-3-parallel-fleet',
    paradigm: 'agent',
    level: 3,
    source: 'examples/cases/agent/fleet_parallel.lp',
    run: ['--reps=1', '--arrivals=1', '--warmup=0'],
    repeatForDeterminism: true,
    verify: ({ metrics, repeatedMetrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.arrivals, 1);
      closeTo(replication.horizon_seconds, 1, 1e-12, 'parallel fleet horizon');
      assert.deepEqual(repeatedMetrics, metrics, 'parallel fleet metrics are not deterministic');
      return { population: 65536, ticks: replication.arrivals, deterministic: true };
    },
  },
  {
    id: 'statechart-1-condition',
    paradigm: 'statechart',
    level: 1,
    source: 'examples/condition_statechart.lp',
    run: ['--reps=1', '--arrivals=10', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.departures, 1);
      closeTo(replication.final_value, 1, 1e-12, 'condition final state');
      bounded(replication.horizon_seconds, 2, 2.05, 'condition transition time');
      return { transitions: 1, finalState: replication.final_value };
    },
  },
  {
    id: 'statechart-2-traffic-light',
    paradigm: 'statechart',
    level: 2,
    source: 'examples/traffic_light.lp',
    run: ['--reps=1', '--arrivals=6', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.departures, 6);
      closeTo(replication.horizon_seconds, 14, 1e-12, 'traffic-light horizon');
      closeTo(replication.final_value, 0, 1e-12, 'traffic-light final state');
      return { transitions: 6, horizon: replication.horizon_seconds };
    },
  },
  {
    id: 'statechart-3-message-relay',
    paradigm: 'statechart',
    level: 3,
    source: 'examples/cases/statechart/message_relay.lp',
    run: ['--reps=1', '--arrivals=4', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.departures, 2);
      closeTo(replication.horizon_seconds, 1, 1e-12, 'message relay horizon');
      closeTo(replication.final_value, 1, 1e-12, 'sender final state');
      return { transitions: 2, sameTimeMessageCascade: true };
    },
  },
  {
    id: 'continuous-1-decay',
    paradigm: 'continuous',
    level: 1,
    source: 'examples/decay.lp',
    run: ['--reps=1', '--arrivals=200', '--warmup=0'],
    trajectory: true,
    verify: ({ metrics, trajectory }) => {
      const replication = firstReplication(metrics);
      const last = trajectory.points.at(-1);
      closeTo(last.t, 2, 1e-12, 'decay horizon');
      closeTo(last.values[0], Math.exp(-1), 2e-6, 'decay analytic solution');
      closeTo(replication.final_value, Math.exp(-1), 2e-4, 'decay final metric');
      return { final: last.values[0], analytic: Math.exp(-1) };
    },
  },
  {
    id: 'continuous-2-sir',
    paradigm: 'continuous',
    level: 2,
    source: 'examples/sir.lp',
    run: ['--reps=1', '--arrivals=6000', '--warmup=0'],
    trajectory: true,
    verify: ({ trajectory }) => {
      let maximumMassError = 0;
      for (const point of trajectory.points) {
        const mass = point.values.reduce((sum, value) => sum + value, 0);
        maximumMassError = Math.max(maximumMassError, Math.abs(mass - 1));
        for (const value of point.values) assert.ok(value >= -1e-10, 'SIR state became negative');
      }
      assert.ok(maximumMassError < 2e-5, `SIR mass error ${maximumMassError}`);
      const initialI = trajectory.points[0].values[1];
      const peakI = Math.max(...trajectory.points.map((point) => point.values[1]));
      assert.ok(peakI > initialI * 5, 'SIR infection never developed');
      return { maximumMassError, peakInfected: peakI };
    },
  },
  {
    id: 'continuous-3-damped-oscillator',
    paradigm: 'continuous',
    level: 3,
    source: 'examples/cases/continuous/damped_oscillator.lp',
    run: ['--reps=1', '--arrivals=200', '--warmup=0'],
    trajectory: true,
    verify: ({ trajectory }) => {
      const first = trajectory.points[0];
      const last = trajectory.points.at(-1);
      closeTo(last.t, 20, 1e-9, 'adaptive oscillator horizon');
      const energy = (point) => 0.5 * (point.values[1] ** 2 + 4 * point.values[0] ** 2);
      assert.ok(energy(last) < energy(first) * 0.01, 'oscillator energy did not decay');
      let crossings = 0;
      for (let index = 1; index < trajectory.points.length; ++index) {
        if (trajectory.points[index - 1].values[0] * trajectory.points[index].values[0] < 0)
          crossings += 1;
      }
      assert.ok(crossings >= 10, `expected at least 10 zero crossings, got ${crossings}`);
      return { acceptedSteps: trajectory.points.length, crossings, finalEnergy: energy(last) };
    },
  },
  {
    id: 'devs-1-timer',
    paradigm: 'devs',
    level: 1,
    source: 'examples/cases/devs/timer.lp',
    run: ['--reps=1', '--arrivals=5', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.arrivals, 5);
      closeTo(replication.horizon_seconds, 5, 1e-12, 'atomic timer horizon');
      return { internalTransitions: 5, horizon: replication.horizon_seconds };
    },
  },
  {
    id: 'devs-2-pulse-chain',
    paradigm: 'devs',
    level: 2,
    source: 'examples/pulse_chain.lp',
    run: ['--reps=1', '--arrivals=5', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.arrivals, 5);
      closeTo(replication.horizon_seconds, 5, 1e-12, 'pulse-chain horizon');
      return { internalTransitions: 5, coupledAtoms: 2 };
    },
  },
  {
    id: 'devs-3-parallel-fanin',
    paradigm: 'devs',
    level: 3,
    source: 'examples/cases/devs/parallel_fanin.lp',
    run: ['--reps=1', '--arrivals=6', '--warmup=0'],
    verify: ({ metrics }) => {
      const replication = firstReplication(metrics);
      assert.equal(replication.arrivals, 6);
      closeTo(replication.horizon_seconds, 3, 1e-12, 'parallel fan-in horizon');
      return { internalTransitions: 6, simultaneousSources: 2 };
    },
  },
  {
    id: 'integration-smart-factory',
    paradigm: 'multi-method',
    level: 4,
    source: 'examples/cases/multimethod/smart_factory.lp',
    run: ['--reps=1', '--arrivals=50', '--warmup=5'],
    verify: ({ metrics }) => {
      const names = metrics.methods.map((entry) => entry.name).sort();
      assert.deepEqual(names, ['agent', 'devs', 'process', 'sd', 'statechart']);
      assert.equal(method(metrics, 'process').departures, 50);
      assert.equal(method(metrics, 'agent').arrivals, 50);
      assert.equal(method(metrics, 'statechart').departures, 50);
      assert.equal(method(metrics, 'devs').arrivals, 50);
      bounded(method(metrics, 'sd').final_value, 20, 80, 'temperature final value');
      return { methods: names, sharedKernel: true };
    },
  },
]);

function option(args, name) {
  const inline = args.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function execute(executable, args, label) {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const elapsedMs = performance.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status})\n${result.stdout}${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr, elapsedMs };
}

function compileCase(lpcli, modelCase, directory) {
  const output = join(directory, `${modelCase.id}.lpir`);
  const result = execute(
    lpcli,
    ['compile', resolve(ROOT, modelCase.source), '-o', output],
    `${modelCase.id} compile`,
  );
  return { output, elapsedMs: result.elapsedMs };
}

function runCaseOnce(lpcli, modelCase, ir, directory, suffix = '') {
  const resultsDir = join(directory, `${modelCase.id}${suffix}.results`);
  const args = [
    'run',
    '--model-file',
    ir,
    `--seed=${DEFAULT_SEED}`,
    ...modelCase.run,
    '--results-dir',
    resultsDir,
  ];
  let trajectoryPath;
  if (modelCase.trajectory) {
    trajectoryPath = join(directory, `${modelCase.id}${suffix}.trajectory.json`);
    args.push('--trajectory', trajectoryPath);
  }
  const result = execute(lpcli, args, `${modelCase.id} run`);
  return {
    metrics: JSON.parse(readFileSync(join(resultsDir, 'metrics.json'), 'utf8')),
    trajectory: trajectoryPath ? JSON.parse(readFileSync(trajectoryPath, 'utf8')) : undefined,
    elapsedMs: result.elapsedMs,
  };
}

export function runModelingCaseMatrix({ lpcli = findLpcli(), reportPath } = {}) {
  assert.ok(lpcli, 'lpcli was not found');
  const directory = mkdtempSync(join(tmpdir(), 'logicpilot-modeling-cases-'));
  const results = [];
  try {
    for (const modelCase of MODELING_CASES) {
      const started = performance.now();
      try {
        const compiled = compileCase(lpcli, modelCase, directory);
        const run = runCaseOnce(lpcli, modelCase, compiled.output, directory);
        let repeatedMetrics;
        let repeatElapsedMs = 0;
        if (modelCase.repeatForDeterminism) {
          const repeated = runCaseOnce(lpcli, modelCase, compiled.output, directory, '-repeat');
          repeatedMetrics = repeated.metrics;
          repeatElapsedMs = repeated.elapsedMs;
        }
        const evidence = modelCase.verify({
          metrics: run.metrics,
          trajectory: run.trajectory,
          repeatedMetrics,
        });
        const result = {
          id: modelCase.id,
          paradigm: modelCase.paradigm,
          level: modelCase.level,
          passed: true,
          durationMs: performance.now() - started,
          compileMs: compiled.elapsedMs,
          runMs: run.elapsedMs + repeatElapsedMs,
          evidence,
        };
        results.push(result);
        console.log(`PASS ${modelCase.id} (${result.durationMs.toFixed(1)} ms)`);
      } catch (error) {
        const result = {
          id: modelCase.id,
          paradigm: modelCase.paradigm,
          level: modelCase.level,
          passed: false,
          durationMs: performance.now() - started,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(result);
        console.error(`FAIL ${modelCase.id}: ${result.error}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const passedCases = results.filter((result) => result.passed).length;
  const report = {
    schemaVersion: 1,
    seed: DEFAULT_SEED,
    generatedAt: new Date().toISOString(),
    lpcli: basename(lpcli),
    summary: {
      cases: results.length,
      passed: passedCases,
      failed: results.length - passedCases,
      passRate: passedCases / results.length,
    },
    results,
  };
  if (reportPath) writeFileSync(resolve(ROOT, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `MODELING CASES: ${report.summary.passed}/${report.summary.cases} passed ` +
      `(${(report.summary.passRate * 100).toFixed(1)}%)`,
  );
  return report;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const report = runModelingCaseMatrix({
    lpcli: option(process.argv.slice(2), 'lpcli') ?? findLpcli(),
    reportPath: option(process.argv.slice(2), 'report'),
  });
  if (report.summary.failed > 0) process.exitCode = 1;
}
