// Bottleneck attribution: run the model, parse the metric summary (including
// the kernel's utilization/availability), and explain the dominant cause in
// plain language (Simulation Copilot: "why is throughput low?").
//
// Usage: node scripts/ai-explain.mjs ["<prompt>"] [--model-file <path>]
//        [--json] [--lpcli <path>] [--question "..."]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleBasedProvider } from './ai-provider.mjs';
import { parseMetric } from './optimize.mjs';

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

export function explainFromSummary(summary, question = '') {
  const findings = [];
  const waitShare = summary.W > 0 ? summary.Wq / summary.W : 0;
  if (summary.availability < 0.97) {
    findings.push(
        `机器可用性仅 ${(summary.availability * 100).toFixed(1)}%` +
        `（约 ${((1 - summary.availability) * 100).toFixed(1)}% 时间处于` +
        `故障/维修）——宕机是吞吐受限与等待上升的主导因素`);
  }
  if (summary.utilization > 0.9) {
    findings.push(
        `服务器池利用率 ${(summary.utilization * 100).toFixed(1)}%，` +
        `接近饱和——容量是瓶颈，建议增加服务器数量`);
  }
  if (waitShare > 0.6) {
    findings.push(
        `等待占滞留时间 ${(waitShare * 100).toFixed(1)}%（Wq/W）——` +
        `瓶颈在排队环节（服务率或容量不足）`);
  }
  if (findings.length === 0) {
    findings.push('各项指标均在健康区间：未发现显著瓶颈');
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
    const output = runLpcli(lpcli, [
      'run', '--model-file', ir,
      '--seed', '42',
      '--reps', String(reps),
      '--arrivals', String(arrivals),
      '--warmup', String(warmup),
    ]);
    const summary = {
      throughput: parseMetric(output, 'throughput'),
      W: parseMetric(output, 'W'),
      Wq: parseMetric(output, 'Wq'),
      Lq: parseMetric(output, 'Lq'),
      utilization: parseMetric(output, 'utilization'),
      availability: parseMetric(output, 'availability'),
    };
    return {
      kind: 'explain',
      question,
      metrics: summary,
      findings: explainFromSummary(summary, question),
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
