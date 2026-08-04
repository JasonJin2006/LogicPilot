// Regression test for bottleneck attribution: the pure rule logic and the
// end-to-end path against examples/mm1_failure.lp (availability ~0.91).
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aiExplain, explainFromSummary } from './ai-explain.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const flag = process.argv.indexOf('--lpcli');
if (flag >= 0 && process.argv[flag + 1]) {
  process.env.LPCLI = process.argv[flag + 1];
}

// 1. Pure rule logic on crafted summaries.
{
  const lowAvailability = explainFromSummary({
    throughput: 0.8, W: 9, Wq: 8, Lq: 6,
    utilization: 0.81, availability: 0.91,
  });
  assert.ok(lowAvailability.some((f) => f.includes('可用性')));

  const saturated = explainFromSummary({
    throughput: 0.8, W: 5, Wq: 2, Lq: 1,
    utilization: 0.97, availability: 1.0,
  });
  assert.ok(saturated.some((f) => f.includes('利用率')));

  const healthy = explainFromSummary({
    throughput: 0.5, W: 2, Wq: 0.3, Lq: 0.1,
    utilization: 0.6, availability: 1.0,
  });
  assert.ok(healthy.some((f) => f.includes('健康')));
}

// 2. End-to-end on the failure model: downtime must be called out.
{
  const result = await aiExplain({
    modelFile: join(root, 'examples', 'mm1_failure.lp'),
    question: 'why is the queue slow?',
    arrivals: 4000,
    warmup: 400,
  });
  assert.equal(result.kind, 'explain');
  assert.ok(result.metrics.availability < 0.97);
  assert.ok(result.findings.some((f) => f.includes('可用性')));
}

// 3. Prompt-driven path returns findings for a plain M/M/1.
{
  const result = await aiExplain({
    prompt:
        'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0',
  });
  assert.equal(result.kind, 'explain');
  assert.ok(result.findings.length >= 1);
}

console.log('EXPLAIN TEST: PASS');
