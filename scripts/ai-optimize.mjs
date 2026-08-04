// Natural-language model optimization: "minimize Wq over servers 1..5 for an
// M/M/1 queue with arrival 0.8 service 1.0" -> parameterized template ->
// grid/GA search -> best configuration.
//
// Usage: node scripts/ai-optimize.mjs "<prompt>" [--json] [--lpcli <path>]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findLpcli, optimize, runLpcli } from './optimize.mjs';
import { ruleBasedProvider } from './ai-provider.mjs';

function parseOptimizeSpec(prompt) {
  const text = prompt.toLowerCase();
  const objective =
      /maximize/.test(text) ? 'maximize' : 'minimize';
  let metric = 'Wq';
  if (/throughput/.test(text)) metric = 'throughput';
  else if (/\bwait\b|mean_wait|wq/.test(text)) metric = 'Wq';
  else if (/\bsojourn\b|\bw\b/.test(text)) metric = 'W';
  else if (/\bqueue\s+length|\blq\b/.test(text)) metric = 'Lq';

  // v1 optimizes the resource server count (the `capacity` slot in the
  // resource block); queue-capacity optimization is future work.
  const variable = 'servers';

  let range = null;
  const dotted = text.match(/(\d+)\s*\.\.\s*(\d+)/);
  const ranged = text.match(/(?:between|from)\s+(\d+)\s+and\s+(\d+)/);
  if (dotted) range = [Number(dotted[1]), Number(dotted[2])];
  else if (ranged) range = [Number(ranged[1]), Number(ranged[2])];
  if (!range) range = [1, 8];

  return { objective, metric, variable, range };
}

// The rule-based provider renders `capacity = N` for the resource first;
// swap that first occurrence for the {{variable}} slot.
function parameterize(dsl, variable) {
  return dsl.replace(/capacity = \d+/, `capacity = {{${variable}}}`);
}

function experimentBlock(spec) {
  return `  experiment Optimization {
    objective = ${spec.objective}
    metric = ${spec.metric}
    variable = ${spec.variable}
    range = ${spec.range[0]}..${spec.range[1]}
    budget = ${spec.budget ?? 20}
  }
`;
}

export async function aiOptimize({
  prompt,
  lpcli = '',
  budget = 20,
  strategy = 'auto',
}) {
  const spec = parseOptimizeSpec(prompt);
  const base = ruleBasedProvider(prompt);
  const template = parameterize(base, spec.variable);
  const resolvedLpcli = lpcli || process.env.LPCLI || findLpcli();
  let declaredByModel = false;

  // Declare the experiment inside the model and read it back: the search
  // spec comes from the model (IR v2 direction), not from prompt parsing.
  const dir = mkdtempSync(join(tmpdir(), 'ai-optimize-'));
  try {
    const declaredModel = base.replace(/\}\s*$/, experimentBlock(spec) + '}');
    const lp = join(dir, 'declared.lp');
    const json = join(dir, 'declared.json');
    writeFileSync(lp, declaredModel, 'utf8');
    try {
      runLpcli(resolvedLpcli, ['compile', lp, '--experiments-json', json]);
      const parsed = JSON.parse(readFileSync(json, 'utf8'));
      const experiment = parsed.experiments?.[0];
      if (experiment) {
        spec.objective = experiment.objective;
        spec.metric = experiment.metric;
        spec.variable = experiment.variable;
        spec.range = [experiment.range[0], experiment.range[1]];
        if (Number.isFinite(experiment.budget) && experiment.budget > 0) {
          budget = experiment.budget;
        }
        declaredByModel = true;
      }
    } catch {
      // Prompt-parsed spec is the fallback when the sidecar cannot be read.
    }

    const result = await optimize({
      template,
      variable: spec.variable,
      min: spec.range[0],
      max: spec.range[1],
      objective: spec.objective,
      metric: spec.metric,
      strategy,
      budget,
      lpcli: resolvedLpcli || undefined,
    });
    return {
      ...result,
      kind: 'optimize',
      prompt,
      dslTemplate: template,
      declaredByModel,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const lpcliFlag = argv.indexOf('--lpcli');
  const lpcli = lpcliFlag >= 0 && argv[lpcliFlag + 1] ? argv[lpcliFlag + 1] : '';
  const prompt = argv.filter((arg) => !arg.startsWith('--')).join(' ');
  if (!prompt) {
    console.error(
        'usage: node scripts/ai-optimize.mjs "<prompt>" [--json] ' +
        '[--lpcli <path>]');
    process.exit(2);
  }
  const result = await aiOptimize({ prompt, lpcli });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
        `[ai-optimize] best ${result.variable}=${result.best.value} ` +
        `${result.objective} ${result.metric} -> ${result.best.score} ` +
        `(${result.strategy}, ${result.evaluations.length} evaluations)`);
  }
}

if (process.argv[1] &&
    import.meta.url ===
        new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
