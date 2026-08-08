// Bottleneck attribution: run the model, parse the metric summary (including
// the kernel's utilization/availability), and explain the dominant cause in
// plain language (Simulation Copilot: "why is throughput low?").
//
// Usage: node scripts/ai-explain.mjs ["<prompt>"] [--model-file <path>]
//        [--json] [--lpcli <path>] [--question "..."]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ruleBasedProvider } from './ai-provider.mjs';
import { parseMetric } from './optimize.mjs';
import { findLpcli } from './tool-paths.mjs';

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

export function explainFromSummary(summary, question = '', blocks = []) {
  const findings = [];
  const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const utilized = (blocks ?? [])
    .filter((block) => finite(block.utilization) > 0)
    .sort((a, b) => finite(b.utilization) - finite(a.utilization));
  const queued = (blocks ?? [])
    .filter(
      (block) =>
        (block.kind === 'queue' || block.kind === 'wait') &&
        finite(block.mean_occupancy) > 0,
    )
    .sort((a, b) => finite(b.mean_occupancy) - finite(a.mean_occupancy));
  const busiest = utilized[0];
  const largestQueue = queued[0];
  const waitShare = summary.W > 0 ? summary.Wq / summary.W : 0;
  if (busiest) {
    const saturation =
      finite(busiest.utilization) > 0.9
        ? ' (saturated - adding capacity there will help the most)'
        : '.';
    findings.push(
      `Bottleneck: ${busiest.name} has the highest utilization at ` +
      `${(finite(busiest.utilization) * 100).toFixed(1)}%${saturation}`,
    );
  } else if (summary.utilization > 0.9) {
    findings.push(
      `Server pool utilization is ${(summary.utilization * 100).toFixed(1)}%, ` +
        'near saturation - capacity is the bottleneck',
    );
  }
  if (summary.availability < 0.97) {
    findings.push(
      `Availability is only ${(summary.availability * 100).toFixed(1)}% ` +
        `(${((1 - summary.availability) * 100).toFixed(1)}% of the time in ` +
        'failure/repair); downtime is the dominant cause of congestion.',
    );
  }
  if (largestQueue) {
    findings.push(
      `${largestQueue.name} has the largest mean queue occupancy at ` +
        `${finite(largestQueue.mean_occupancy).toFixed(3)} agents`,
    );
  }
  if (waitShare > 0.6) {
    findings.push(
      `Waiting accounts for ${(waitShare * 100).toFixed(1)}% of sojourn ` +
        `(Wq/W)${largestQueue ? `; the queue builds before ${largestQueue.name}` : ''}.`,
    );
  }
  if (findings.length === 0) {
    findings.push('All indicators are in the healthy range; no significant bottleneck found.');
  }
  return findings;
}

export async function aiExplain({
  prompt = '',
  modelFile = '',
  question = 'why is throughput low?',
  lpcli = findLpcli(),
  reps = 3,
  arrivals = 2000,
  warmup = 200,
}) {
  let ir = modelFile;
  let dsl = '';
  const dir = mkdtempSync(join(tmpdir(), 'ai-explain-'));
  try {
    if (ir && ir.endsWith('.lp')) {
      const lp = ir;
      ir = join(dir, 'model.ir.bin');
      runLpcli(lpcli, ['compile', lp, '-o', ir]);
    }
    if (!ir) {
      dsl = ruleBasedProvider(prompt);
      const lp = join(dir, 'model.lp');
      ir = join(dir, 'model.ir.bin');
      writeFileSync(lp, dsl, 'utf8');
      runLpcli(lpcli, ['compile', lp, '-o', ir]);
    }
    const resultsDir = join(dir, 'results');
    const output = runLpcli(lpcli, [
      'run', '--model-file', ir,
      '--seed', '42',
      '--reps', String(reps),
      '--arrivals', String(arrivals),
      '--warmup', String(warmup),
      '--results-dir', resultsDir,
    ]);
    let summary;
    let blocks = [];
    const metricsPath = join(resultsDir, 'metrics.json');
    if (existsSync(metricsPath)) {
      const metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
      const mean = (name) => metrics.summary?.[name]?.mean ?? 0;
      summary = {
        throughput: mean('throughput'),
        W: mean('W'),
        Wq: mean('Wq'),
        Lq: mean('Lq'),
        utilization: mean('utilization'),
        availability: mean('availability'),
      };
      blocks = metrics.blocks ?? [];
    } else {
      summary = {
        throughput: parseMetric(output, 'throughput'),
        W: parseMetric(output, 'W'),
        Wq: parseMetric(output, 'Wq'),
        Lq: parseMetric(output, 'Lq'),
        utilization: parseMetric(output, 'utilization'),
        availability: parseMetric(output, 'availability'),
      };
    }
    return {
      kind: 'explain',
      question,
      metrics: summary,
      blocks,
      findings: explainFromSummary(summary, question, blocks),
      output,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : '';
  };
  const modelFile = flag('--model-file');
  const lpcli = flag('--lpcli');
  const question = flag('--question');
  const prompt = argv.filter((arg) => !arg.startsWith('--')).join(' ');
  if (!modelFile && !prompt) {
    console.error(
        'usage: node scripts/ai-explain.mjs "<prompt>" [--model-file <ir>] ' +
        '[--question "..."] [--json]');
    process.exit(2);
  }
  const result = await aiExplain({
    prompt,
    modelFile,
    question: question || undefined,
    lpcli: lpcli || undefined,
  });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[ai-explain] ${result.question}`);
    for (const finding of result.findings) {
      console.log(`  - ${finding}`);
    }
    console.log(
        `  metrics: throughput=${result.metrics.throughput.toFixed(3)} ` +
        `Wq=${result.metrics.Wq.toFixed(2)} ` +
        `utilization=${(result.metrics.utilization * 100).toFixed(1)}% ` +
        `availability=${(result.metrics.availability * 100).toFixed(1)}%`);
  }
}

if (process.argv[1] &&
    import.meta.url ===
        new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
