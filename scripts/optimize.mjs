// Parameter optimization for LogicPilot DSL models.
//
// A DSL template carries a numeric slot as {{<variable>}} (e.g.
// `capacity = {{servers}}`). optimize() substitutes candidate values,
// compiles + runs each with `lpcli run` (fixed seed), scores the objective
// metric parsed from the summary, and returns the best configuration.
// Strategies: `grid` (exhaustive small ranges) and `ga` (deterministic
// genetic algorithm, mulberry32-seeded) for larger spaces.
//
// CLI:
//   node scripts/optimize.mjs --template <file.lp> --variable servers \
//     --min 1 --max 8 --objective minimize --metric Wq [--strategy grid|ga] \
//     [--budget 20] [--lpcli <path>] [--json]
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
  if (process.platform === 'win32') {
    const mingwBin = 'C:\\msys64\\ucrt64\\bin';
    if (existsSync(mingwBin) &&
        !(process.env.PATH ?? '').split(';').includes(mingwBin)) {
      process.env.PATH = `${mingwBin};${process.env.PATH ?? ''}`;
    }
  }
  return execFileSync(lpcli, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Substitutes {{variable}} in the DSL template.
export function substitute(template, variable, value) {
  return template.split(`{{${variable}}}`).join(String(value));
}

// Parses `mean=` for `metric` from an `lpcli run` summary block.
//   "  throughput   mean=0.7986 std=0.0057 CI=[...]"
export function parseMetric(output, metric) {
  const expression = new RegExp(
      `^\\s{2}${metric}\\s+mean=([\\d.eE+-]+)`, 'm');
  const match = output.match(expression);
  if (!match) {
    throw new Error(
        `metric '${metric}' not found in lpcli run output:\n${output}`);
  }
  return Number(match[1]);
}

// Deterministic PRNG (mulberry32) for the genetic algorithm.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function better(a, b, objective) {
  return objective === 'maximize' ? a > b : a < b;
}

export async function optimize({
  template,
  variable,
  min,
  max,
  objective = 'minimize',
  metric = 'Wq',
  strategy = 'grid',
  budget = 20,
  seed = 1,
  lpcli = findLpcli(),
  reps = 3,
  arrivals = 2000,
  warmup = 200,
  evaluate = null,
}) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const cache = new Map();

  const score = async (value) => {
    if (cache.has(value)) {
      return cache.get(value);
    }
    let metricValue;
    let output = '';
    if (evaluate) {
      metricValue = await evaluate(value);
    } else {
      const dir = mkdtempSync(join(tmpdir(), 'lp-opt-'));
      try {
        const dsl = substitute(template, variable, value);
        const lp = join(dir, 'model.lp');
        const ir = join(dir, 'model.ir.bin');
        writeFileSync(lp, dsl, 'utf8');
        runLpcli(lpcli, ['compile', lp, '-o', ir]);
        output = runLpcli(lpcli, [
          'run', '--model-file', ir,
          '--seed', '42',
          '--reps', String(reps),
          '--arrivals', String(arrivals),
          '--warmup', String(warmup),
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      metricValue = parseMetric(output, metric);
    }
    cache.set(value, metricValue);
    return metricValue;
  };

  let bestValue = null;
  let bestScore = null;
  const evaluations = [];
  const consider = async (value) => {
    const v = Math.round(value);
    if (v < lo || v > hi || cache.has(v)) {
      return;
    }
    const s = await score(v);
    evaluations.push({ value: v, score: s });
    if (bestValue === null || better(s, bestScore, objective)) {
      bestValue = v;
      bestScore = s;
    }
  };

  if (strategy === 'grid' || hi - lo + 1 <= budget) {
    for (let value = lo; value <= hi; ++value) {
      await consider(value);
    }
  } else {
    // Deterministic GA: population -> tournament -> crossover/mutation.
    const rand = mulberry32(seed);
    const population = [];
    for (let i = 0; i < 8; ++i) {
      population.push(lo + Math.floor(rand() * (hi - lo + 1)));
    }
    for (const member of population) {
      await consider(member);
    }
    let generation = 0;
    while (evaluations.length < budget && generation < 100) {
      ++generation;
      const tournament = async () => {
        const pool = [];
        for (let i = 0; i < 3; ++i) {
          pool.push(population[Math.floor(rand() * population.length)]);
        }
        let winner = pool[0];
        let winnerScore = Infinity;
        for (const member of pool) {
          const s = cache.get(member) ?? (await score(member));
          if (winnerScore === Infinity || better(s, winnerScore, objective)) {
            winner = member;
            winnerScore = s;
          }
        }
        return winner;
      };
      const parentA = await tournament();
      const parentB = await tournament();
      let child = Math.round((parentA + parentB) / 2);
      child += Math.floor(rand() * 5) - 2;  // mutate by -2..+2
      await consider(child);
    }
  }

  evaluations.sort((a, b) => a.value - b.value);
  return {
    variable,
    objective,
    metric,
    strategy: strategy === 'grid' || hi - lo + 1 <= budget ? 'grid' : 'ga',
    best: { value: bestValue, score: bestScore },
    evaluations,
    range: [lo, hi],
  };
}

function parseArgs(argv) {
  const options = {
    template: '',
    variable: 'servers',
    min: 1,
    max: 8,
    objective: 'minimize',
    metric: 'Wq',
    strategy: 'grid',
    budget: 20,
    lpcli: '',
    reps: 3,
    arrivals: 2000,
    warmup: 200,
    json: false,
  };
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--template') options.template = next();
    else if (arg === '--variable') options.variable = next();
    else if (arg === '--min') options.min = Number(next());
    else if (arg === '--max') options.max = Number(next());
    else if (arg === '--objective') options.objective = next();
    else if (arg === '--metric') options.metric = next();
    else if (arg === '--strategy') options.strategy = next();
    else if (arg === '--budget') options.budget = Number(next());
    else if (arg === '--lpcli') options.lpcli = next();
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--arrivals') options.arrivals = Number(next());
    else if (arg === '--warmup') options.warmup = Number(next());
    else if (arg === '--json') options.json = true;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.template) {
    console.error(
        'usage: node scripts/optimize.mjs --template <file.lp> --variable ' +
        '<name> --min <n> --max <n> [--objective minimize|maximize] ' +
        '[--metric Wq|throughput] [--strategy grid|ga] [--budget <n>] ' +
        '[--json]');
    process.exit(2);
  }
  const template = readFileSync(options.template, 'utf8');
  const result = await optimize({
    template,
    variable: options.variable,
    min: options.min,
    max: options.max,
    objective: options.objective,
    metric: options.metric,
    strategy: options.strategy,
    budget: options.budget,
    lpcli: options.lpcli || undefined,
    reps: options.reps,
    arrivals: options.arrivals,
    warmup: options.warmup,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
        `[optimize] best ${result.variable}=${result.best.value} ` +
        `${result.objective} ${result.metric} -> ${result.best.score} ` +
        `(${result.strategy}, ${result.evaluations.length} evaluations)`);
  }
}

if (process.argv[1] &&
    import.meta.url ===
        new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
