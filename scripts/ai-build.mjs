// AI model build loop: natural language -> DSL -> compile -> structured
// diagnostics -> repair -> ... -> run.
//
// Usage:
//   node scripts/ai-build.mjs "<prompt>" [options]
//     --out <path>            save the final DSL
//     --max-iterations <n>    repair budget (default 3)
//     --lpcli <path>          lpcli binary (default: LPCLI env, then common
//                             build dirs, then PATH)
//     --run                   compile + run the final model
//     --seed/--reps/--arrivals/--warmup/--confidence   experiment settings
//     --test-sabotage-first   break the first attempt (CI regression hook)
//     --json                  machine-readable report on stdout
//
// Provider: scripts/ai-provider.mjs (rule-based offline; LLM when
// OPENAI_API_KEY is set). The loop is the same either way: diagnostics JSON
// from `lpcli compile --diagnostics-json` is fed back into the provider.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveProvider } from './ai-provider.mjs';
import { extendNativeRuntimePath, findLpcli } from './tool-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_RUN_PARAMS = Object.freeze({
  seed: 42,
  seedMode: 'fixed',
  reps: 3,
  replicationMode: 'fixed',
  minReps: 5,
  maxReps: 100,
  errorPercent: 5,
  precisionMetric: 'Wq',
  arrivals: 4000,
  warmup: 400,
  confidence: 0.95,
});

export function normalizeRunParams(runParams = {}) {
  const value = { ...DEFAULT_RUN_PARAMS, ...runParams };
  const integer = (name, minimum) => {
    if (!Number.isSafeInteger(value[name]) || value[name] < minimum) {
      throw new Error(`${name} must be a safe integer >= ${minimum}`);
    }
  };
  integer('seed', 0);
  integer('reps', 1);
  integer('minReps', 2);
  integer('maxReps', 2);
  integer('arrivals', 1);
  integer('warmup', 0);
  if (value.warmup >= value.arrivals) {
    throw new Error('warmup must be < arrivals');
  }
  if (!['fixed', 'random'].includes(value.seedMode)) {
    throw new Error("seedMode must be 'fixed' or 'random'");
  }
  if (!['fixed', 'precision'].includes(value.replicationMode)) {
    throw new Error("replicationMode must be 'fixed' or 'precision'");
  }
  if (value.maxReps < value.minReps) {
    throw new Error('maxReps must be >= minReps');
  }
  if (!Number.isFinite(value.errorPercent) || value.errorPercent <= 0) {
    throw new Error('errorPercent must be greater than 0');
  }
  if (!['throughput', 'L', 'Lq', 'W', 'Wq', 'measure', 'utilization',
    'availability', 'final_value'].includes(value.precisionMetric)) {
    throw new Error('invalid precisionMetric');
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence <= 0 || value.confidence >= 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  return value;
}

function experimentCliArgs(experiment) {
  const args = experiment.seedMode === 'random'
    ? ['--random-seed']
    : ['--seed', String(experiment.seed)];
  if (experiment.replicationMode === 'precision') {
    args.push('--precision-reps', '--min-reps', String(experiment.minReps),
      '--max-reps', String(experiment.maxReps), '--error-percent',
      String(experiment.errorPercent), '--precision-metric', experiment.precisionMetric);
  } else {
    args.push('--reps', String(experiment.reps));
  }
  return args;
}

function effectiveComparisonExperiment(requested, runRecord) {
  if (runRecord == null) return requested;
  return {
    ...requested,
    seed: runRecord.seed,
    seedMode: 'fixed',
    reps: runRecord.actualReps ?? runRecord.reps,
    replicationMode: 'fixed',
  };
}

function runLpcli(lpcli, args) {
  extendNativeRuntimePath(lpcli);
  // MinGW-built lpcli needs its runtime DLLs (ucrt64) on PATH; make the
  // loop independent of how the parent process was launched (e.g. the Vite
  // dev server). No-op on non-Windows / when msys2 is absent.
  if (process.platform === 'win32' &&
      /[\\/](?:local-mingw|local-gcc)[\\/]/i.test(lpcli)) {
    const mingwBin = 'C:\\msys64\\ucrt64\\bin';
    if (existsSync(mingwBin) &&
        !(process.env.PATH ?? '').split(';').includes(mingwBin)) {
      process.env.PATH = `${mingwBin};${process.env.PATH ?? ''}`;
    }
  }
  // Capture stderr instead of inheriting it so --json reports stay clean;
  // failed compiles surface their diagnostics through --diagnostics-json.
  return execFileSync(lpcli, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Zero the resource `capacity` value: forces an LP3001 diagnostic (capacity
// must be >= 1) on the first attempt so the repair loop is exercised
// deterministically (the catalog registry gives every field a default, so a
// missing field no longer errors).
function sabotage(dsl) {
  return dsl.replace(
    /^(\s*capacity\s*=\s*)\d+(\s*)$/m,
    (match, before, after) => `${before}0${after}`,
  );
}

export function validateModelDsl({ dsl, lpcli = findLpcli() }) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-validate-model-'));
  try {
    const modelPath = join(dir, 'model.lp');
    const irPath = join(dir, 'model.ir.bin');
    const diagnosticsPath = join(dir, 'diagnostics.json');
    writeFileSync(modelPath, dsl, 'utf8');
    try {
      runLpcli(lpcli, [
        'compile', modelPath,
        '-o', irPath,
        '--diagnostics-json', diagnosticsPath,
      ]);
      return { ok: true, diagnostics: [] };
    } catch (error) {
      let diagnostics;
      try {
        diagnostics = JSON.parse(readFileSync(diagnosticsPath, 'utf8')).diagnostics ?? [];
      } catch {
        diagnostics = [{
          code: 'LP0002',
          severity: 'error',
          message: String(error.stderr ?? error.message),
        }];
      }
      return { ok: false, diagnostics };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runModelDsl({
  dsl,
  lpcli = findLpcli(),
  runParams = DEFAULT_RUN_PARAMS,
}) {
  const experiment = normalizeRunParams(runParams);
  const dir = mkdtempSync(join(tmpdir(), 'ai-run-model-'));
  try {
    const modelPath = join(dir, 'model.lp');
    const irPath = join(dir, 'model.ir.bin');
    const diagnosticsPath = join(dir, 'diagnostics.json');
    const trajectoryPath = join(dir, 'trajectory.json');
    writeFileSync(modelPath, dsl, 'utf8');
    try {
      runLpcli(lpcli, [
        'compile', modelPath,
        '-o', irPath,
        '--diagnostics-json', diagnosticsPath,
      ]);
    } catch (error) {
      let diagnostics;
      try {
        diagnostics = JSON.parse(readFileSync(diagnosticsPath, 'utf8')).diagnostics ?? [];
      } catch {
        diagnostics = [{
          code: 'LP0002',
          severity: 'error',
          message: String(error.stderr ?? error.message),
        }];
      }
      return {
        ok: false,
        diagnostics,
        runSummary: '',
        metrics: null,
        trajectory: null,
        verification: null,
      };
    }

    const runSummary = runLpcli(lpcli, [
      'run', '--model-file', irPath,
      ...experimentCliArgs(experiment),
      '--arrivals', String(experiment.arrivals),
      '--warmup', String(experiment.warmup),
      '--confidence', String(experiment.confidence),
      '--trajectory', trajectoryPath,
      '--results-dir', dir,
    ]);
    const metricsPath = join(dir, 'metrics.json');
    const runPath = join(dir, 'run.json');
    const metrics = existsSync(metricsPath)
      ? JSON.parse(readFileSync(metricsPath, 'utf8'))
      : null;
    const runRecord = existsSync(runPath)
      ? JSON.parse(readFileSync(runPath, 'utf8'))
      : null;
    const trajectory = existsSync(trajectoryPath)
      ? JSON.parse(readFileSync(trajectoryPath, 'utf8'))
      : null;
    let verification = null;
    if (metrics !== null) {
      try {
        verification = JSON.parse(execFileSync(
          process.execPath,
          [join(here, 'verify-run.mjs'), metricsPath],
          { encoding: 'utf8' },
        ));
      } catch (error) {
        if (error.stdout) {
          try {
            verification = JSON.parse(String(error.stdout));
          } catch {
            verification = null;
          }
        }
      }
    }
    return {
      ok: true,
      diagnostics: [],
      runSummary,
      metrics,
      trajectory,
      verification,
      experiment: effectiveComparisonExperiment(experiment, runRecord),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function buildModel({
  prompt,
  contextDsl = '',
  lpcli = findLpcli(),
  maxIterations = 3,
  sabotageFirst = false,
  run = false,
  runParams = DEFAULT_RUN_PARAMS,
}) {
  const experiment = normalizeRunParams(runParams);
  const provider = resolveProvider();
  const dir = mkdtempSync(join(tmpdir(), 'ai-build-'));
  try {
    let diagnostics = [];
    let previousDsl = '';
    let finalDsl = '';
    let ok = false;
    let iterations = 0;
    let runTrajectory = null;
    for (let attempt = 0; attempt < maxIterations; ++attempt) {
      iterations = attempt + 1;
      finalDsl = await provider(prompt, diagnostics, previousDsl, contextDsl);
      previousDsl = finalDsl;
      let candidate = finalDsl;
      if (sabotageFirst && attempt === 0) {
        candidate = sabotage(candidate);
      }
      const lp = join(dir, `model-${attempt}.lp`);
      const json = join(dir, `model-${attempt}.json`);
      writeFileSync(lp, candidate, 'utf8');
      try {
        runLpcli(lpcli, ['compile', lp, '--diagnostics-json', json]);
        ok = true;
        break;
      } catch (error) {
        let parsed = null;
        try {
          parsed = JSON.parse(readFileSync(json, 'utf8'));
        } catch {
          parsed = null;
        }
        diagnostics =
            parsed?.diagnostics ??
            [{ code: 'LP0002', severity: 'error', message: String(error.stderr ?? error.message) }];
        if (diagnostics.length === 0) {
          break;  // failed without diagnostics; nothing to repair against
        }
      }
    }
    let runSummary = '';
    let verification = null;
    let runMetrics = null;
    let effectiveExperiment = experiment;
    if (ok && run) {
      const runDir = mkdtempSync(join(tmpdir(), 'ai-run-'));
      try {
        const lp = join(runDir, 'model.lp');
        const ir = join(runDir, 'model.ir.bin');
        const trajectoryPath = join(runDir, 'trajectory.json');
        writeFileSync(lp, finalDsl, 'utf8');
        runLpcli(lpcli, ['compile', lp, '-o', ir]);
        runSummary = runLpcli(lpcli, [
          'run', '--model-file', ir,
          ...experimentCliArgs(experiment),
          '--arrivals', String(experiment.arrivals),
          '--warmup', String(experiment.warmup),
          '--confidence', String(experiment.confidence),
          '--trajectory', trajectoryPath,
          '--results-dir', runDir,
        ]);
        if (existsSync(trajectoryPath)) {
          runTrajectory = JSON.parse(readFileSync(trajectoryPath, 'utf8'));
        }
        // P1 verification loop: check the run's metrics.json against the
        // invariant checks (conservation / finiteness / positive throughput).
        const metricsPath = join(runDir, 'metrics.json');
        const runPath = join(runDir, 'run.json');
        if (existsSync(runPath)) {
          effectiveExperiment = effectiveComparisonExperiment(
            experiment, JSON.parse(readFileSync(runPath, 'utf8')),
          );
        }
        if (existsSync(metricsPath)) {
          try {
            runMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
          } catch {
            runMetrics = null;
          }
          try {
            const verifyOut = execFileSync(
              process.execPath,
              [join(here, 'verify-run.mjs'), metricsPath],
              { encoding: 'utf8' },
            );
            verification = JSON.parse(verifyOut);
          } catch (error) {
            // The verifier exits 1 when a check fails but still prints the
            // report on stdout; a failed verification is a result, not a
            // crash of the build loop.
            if (error.stdout) {
              try {
                verification = JSON.parse(String(error.stdout));
              } catch {
                verification = null;
              }
            }
          }
        }
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    }
    return {
      ok,
      iterations,
      dsl: finalDsl,
      lpcli,
      lastDiagnostics: diagnostics,
      runSummary,
      metrics: runMetrics,
      trajectory: runTrajectory,
      verification,
      experiment: effectiveExperiment,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {
    prompt: '',
    out: '',
    maxIterations: 3,
    lpcli: '',
    run: false,
    seed: DEFAULT_RUN_PARAMS.seed,
    reps: 3,
    arrivals: DEFAULT_RUN_PARAMS.arrivals,
    warmup: DEFAULT_RUN_PARAMS.warmup,
    confidence: DEFAULT_RUN_PARAMS.confidence,
    sabotageFirst: false,
    json: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--out') options.out = next();
    else if (arg === '--max-iterations') options.maxIterations = Number(next());
    else if (arg === '--lpcli') options.lpcli = next();
    else if (arg === '--seed') options.seed = Number(next());
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--arrivals') options.arrivals = Number(next());
    else if (arg === '--warmup') options.warmup = Number(next());
    else if (arg === '--confidence') options.confidence = Number(next());
    else if (arg === '--run') options.run = true;
    else if (arg === '--test-sabotage-first') options.sabotageFirst = true;
    else if (arg === '--json') options.json = true;
    else positional.push(arg);
  }
  options.prompt = positional.join(' ');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.prompt) {
    console.error(
        'usage: node scripts/ai-build.mjs "<prompt>" [--out <path>] ' +
        '[--run] [--max-iterations <n>] [--json]');
    process.exit(2);
  }
  const lpcli = options.lpcli || findLpcli();
  const result = await buildModel({
    prompt: options.prompt,
    lpcli,
    maxIterations: options.maxIterations,
    sabotageFirst: options.sabotageFirst,
    run: options.run,
    runParams: {
      seed: options.seed,
      reps: options.reps,
      arrivals: options.arrivals,
      warmup: options.warmup,
      confidence: options.confidence,
    },
  });

  if (result.ok && options.out) {
    writeFileSync(options.out, result.dsl, 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  for (const diagnostic of result.lastDiagnostics) {
    console.error(`[ai-build] ${diagnostic.code}: ${diagnostic.message}`);
  }
  console.log(
      `[ai-build] result: ok=${result.ok} iterations=${result.iterations} ` +
      `(provider=${process.env.OPENAI_API_KEY ? 'llm' : 'rule-based'})`);
  if (result.ok) {
    console.log('[ai-build] --- generated DSL ---');
    console.log(result.dsl.trimEnd());
    if (result.runSummary) {
      console.log('[ai-build] --- run summary ---');
      console.log(result.runSummary.trimEnd());
    }
    if (options.out) {
      console.log(`[ai-build] saved DSL -> ${options.out}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
