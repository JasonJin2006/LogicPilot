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
//     --reps/--arrivals/--warmup   run parameters (default 3/2000/200)
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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function findLpcli() {
  if (process.env.LPCLI && existsSync(process.env.LPCLI)) {
    return process.env.LPCLI;
  }
  const exe = process.platform === 'win32' ? 'lpcli.exe' : 'lpcli';
  for (const dir of ['integration-dev', 'local-mingw']) {
    const candidate = join(root, 'build', dir, 'kernel', 'apps', 'lpcli', exe);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'lpcli';
}

function runLpcli(lpcli, args) {
  // MinGW-built lpcli needs its runtime DLLs (ucrt64) on PATH; make the
  // loop independent of how the parent process was launched (e.g. the Vite
  // dev server). No-op on non-Windows / when msys2 is absent.
  if (process.platform === 'win32') {
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

export async function buildModel({
  prompt,
  lpcli = findLpcli(),
  maxIterations = 3,
  sabotageFirst = false,
  run = false,
  runParams = { reps: 3, arrivals: 2000, warmup: 200 },
}) {
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
      finalDsl = await provider(prompt, diagnostics, previousDsl);
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
          '--seed', '42',
          '--reps', String(runParams.reps),
          '--arrivals', String(runParams.arrivals),
          '--warmup', String(runParams.warmup),
          '--trajectory', trajectoryPath,
        ]);
        if (existsSync(trajectoryPath)) {
          runTrajectory = JSON.parse(readFileSync(trajectoryPath, 'utf8'));
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
      trajectory: runTrajectory,
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
    reps: 3,
    arrivals: 2000,
    warmup: 200,
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
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--arrivals') options.arrivals = Number(next());
    else if (arg === '--warmup') options.warmup = Number(next());
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
      reps: options.reps,
      arrivals: options.arrivals,
      warmup: options.warmup,
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
