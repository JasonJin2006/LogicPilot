// AnyLogic-style parameter variation experiment runner.
//
// A declared experiment owns one or more `axis` ranges. Each Cartesian-product
// point is compiled with typed top-level parameter overrides, then executed
// with the experiment's fixed or precision-driven replication policy. Results
// are structured JSON; stdout parsing is deliberately not part of the contract.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { extendNativeRuntimePath, findLpcli } from './tool-paths.mjs';

const execFileAsync = promisify(execFile);

async function lpcli(lpcliPath, args) {
  extendNativeRuntimePath(lpcliPath);
  return execFileAsync(lpcliPath, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

export function axisValues(axis) {
  if (Array.isArray(axis.values)) {
    if (axis.values.length === 0 ||
        !axis.values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`axis '${axis.name}' values must be a non-empty number list`);
    }
    return axis.values.map((value) => Number(value.toPrecision(15)));
  }
  const { min, max, step } = axis;
  if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) {
    throw new Error(`invalid axis '${axis.name}' range/step`);
  }
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  if (count < 1 || count > 100000) throw new Error(`axis '${axis.name}' is too large`);
  return Array.from({ length: count }, (_, index) => {
    const value = min + index * step;
    return Number(value.toPrecision(15));
  });
}

export function cartesianPoints(axes) {
  let points = [{}];
  for (const axis of axes) {
    const next = [];
    for (const point of points) {
      for (const value of axisValues(axis)) {
        next.push({ ...point, [axis.variable]: value });
      }
    }
    points = next;
    if (points.length > 100000) throw new Error('variation exceeds 100000 combinations');
  }
  return points;
}

// Deterministic Monte Carlo sampling over the axes (mulberry32 LCG). Each
// point draws a uniform value per axis; when the axis declares a step the
// value snaps to the nearest step and is clamped to [min, max].
export function sampleMonteCarlo(axes, samples, seed = 1) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100000) {
    throw new Error('samples must be an integer in [1, 100000]');
  }
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('seed must be a non-negative integer');
  }
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const points = [];
  for (let sample = 0; sample < samples; ++sample) {
    const point = {};
    for (const axis of axes) {
      if (Array.isArray(axis.values)) {
        const index = Math.floor(random() * axis.values.length);
        point[axis.variable] = Number(axis.values[index].toPrecision(15));
        continue;
      }
      const { min, max, step } = axis;
      if (![min, max].every(Number.isFinite) || max < min) {
        throw new Error(`invalid axis '${axis.name}' range`);
      }
      let value = min + random() * (max - min);
      if (Number.isFinite(step) && step > 0) {
        value = min + Math.round((value - min) / step) * step;
      }
      value = Math.min(max, Math.max(min, value));
      point[axis.variable] = Number(value.toPrecision(15));
    }
    points.push(point);
  }
  return points;
}

function runArgs(experiment) {
  const args = experiment.seed_mode === 'random'
    ? ['--random-seed']
    : ['--seed', String(experiment.seed)];
  if (experiment.replication_mode === 'precision') {
    args.push('--precision-reps', '--min-reps', String(experiment.min_replications),
      '--max-reps', String(experiment.max_replications), '--confidence',
      String(experiment.confidence), '--error-percent', String(experiment.error_percent),
      '--precision-metric', experiment.metric);
  } else {
    args.push('--reps', String(experiment.replications), '--confidence',
      String(experiment.confidence));
  }
  return args;
}

export async function runParameterVariation({
  dsl,
  experimentName,
  axes: axesOverride,
  sampling = 'grid',
  samples = 10,
  seed = 1,
  lpcliPath = findLpcli(),
  arrivals = 4000,
  warmup = 400,
  concurrency = Math.max(1, Math.min(cpus().length, 8)),
}) {
  if (typeof dsl !== 'string' || !dsl.trim()) throw new Error('model DSL is required');
  if (!Number.isSafeInteger(arrivals) || arrivals < 1) throw new Error('arrivals must be >= 1');
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup >= arrivals) {
    throw new Error('warmup must be >= 0 and < arrivals');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }
  if (sampling !== 'grid' && sampling !== 'monte_carlo') {
    throw new Error("sampling must be 'grid' or 'monte_carlo'");
  }

  const root = mkdtempSync(join(tmpdir(), 'logicpilot-variation-'));
  try {
    const source = join(root, 'model.lp');
    const initialIr = join(root, 'model.lpir');
    const sidecar = join(root, 'experiments.json');
    writeFileSync(source, dsl, 'utf8');
    await lpcli(lpcliPath, ['compile', source, '-o', initialIr,
      '--experiments-json', sidecar]);
    const declared = JSON.parse(readFileSync(sidecar, 'utf8')).experiments ?? [];
    const experiment = declared.find((item) =>
      item.kind === 'parameter_variation' &&
      (!experimentName || item.name === experimentName));
    if (!experiment) {
      throw new Error(experimentName
        ? `parameter variation experiment '${experimentName}' not found`
        : 'model declares no parameter variation experiment');
    }
    const axes = axesOverride ?? experiment.axes ?? [];
    const points = sampling === 'monte_carlo'
      ? sampleMonteCarlo(axes, samples, seed)
      : cartesianPoints(axes);
    const iterations = new Array(points.length);
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        if (index >= points.length) return;
        const parameters = points[index];
        const dir = join(root, `point-${index}`);
        const ir = join(root, `point-${index}.lpir`);
        const compileArgs = ['compile', source, '-o', ir];
        for (const [name, value] of Object.entries(parameters)) {
          compileArgs.push('--param', `${name}=${value}`);
        }
        await lpcli(lpcliPath, compileArgs);
        await lpcli(lpcliPath, ['run', '--model-file', ir, ...runArgs(experiment),
          '--arrivals', String(arrivals), '--warmup', String(warmup),
          '--results-dir', dir]);
        const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
        const metrics = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf8'));
        iterations[index] = { index, parameters, run, metrics };
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(concurrency, points.length) }, () => worker()));
    return {
      kind: 'parameter_variation',
      name: experiment.name,
      metric: experiment.metric,
      axes,
      sampling,
      seed: sampling === 'monte_carlo' ? seed : undefined,
      pointCount: points.length,
      iterations,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf('--source');
  const experimentFlag = args.indexOf('--experiment');
  const lpcliFlag = args.indexOf('--lpcli');
  const arrivalsFlag = args.indexOf('--arrivals');
  const warmupFlag = args.indexOf('--warmup');
  const concurrencyFlag = args.indexOf('--concurrency');
  if (sourceFlag < 0 || !args[sourceFlag + 1]) {
    console.error('usage: node scripts/parameter-variation.mjs --source model.lp ' +
      '[--experiment Name] [--lpcli path] [--arrivals n] [--warmup n]');
    process.exit(2);
  }
  const result = await runParameterVariation({
    dsl: readFileSync(args[sourceFlag + 1], 'utf8'),
    experimentName: experimentFlag >= 0 ? args[experimentFlag + 1] : undefined,
    lpcliPath: lpcliFlag >= 0 ? args[lpcliFlag + 1] : undefined,
    arrivals: arrivalsFlag >= 0 ? Number(args[arrivalsFlag + 1]) : undefined,
    warmup: warmupFlag >= 0 ? Number(args[warmupFlag + 1]) : undefined,
    concurrency: concurrencyFlag >= 0 ? Number(args[concurrencyFlag + 1]) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
