import assert from 'node:assert/strict';

import { compareMetrics } from './ai-compare-metrics.mjs';

const compared = compareMetrics({
  before: {
    blocks: [
      { name: 'Waiting', kind: 'queue', mean_occupancy: 5, timed_out_mean: 2 },
      { name: 'Done', kind: 'sink', departed_mean: 80 },
    ],
  },
  after: {
    blocks: [
      { name: 'Waiting', kind: 'queue', mean_occupancy: 2, timed_out_mean: 0 },
      { name: 'Done', kind: 'sink', departed_mean: 95 },
      { name: 'Overflow', kind: 'sink', departed_mean: 3 },
    ],
  },
});

assert.equal(compared.kind, 'metric-comparison');
assert.equal(compared.summary.sinkDeparturesDelta, 18);
assert.equal(compared.summary.timeoutsDelta, -2);
assert.equal(
  compared.blocks.find((block) => block.name === 'Waiting').metrics.mean_occupancy.delta,
  -3,
);
assert.equal(compared.blocks.find((block) => block.name === 'Overflow').status, 'added');
assert.ok(compared.findings.some((finding) => /delta -3\.000/.test(finding)));
assert.deepEqual(compared.statistical, []);

const paired = compareMetrics({
  confidence: 0.95,
  before: {
    blocks: [],
    replications: [
      { rep: 1, seed: 11, throughput: 80, L: 8, Lq: 6, W: 4, Wq: 3, utilization: 0.9, availability: 1 },
      { rep: 2, seed: 12, throughput: 82, L: 9, Lq: 7, W: 5, Wq: 4, utilization: 0.91, availability: 1 },
      { rep: 3, seed: 13, throughput: 79, L: 7, Lq: 5, W: 4, Wq: 3, utilization: 0.89, availability: 1 },
    ],
  },
  after: {
    blocks: [],
    replications: [
      { rep: 1, seed: 11, throughput: 90, L: 4, Lq: 2, W: 2, Wq: 1, utilization: 0.7, availability: 1 },
      { rep: 2, seed: 12, throughput: 92, L: 5, Lq: 3, W: 3, Wq: 2, utilization: 0.71, availability: 1 },
      { rep: 3, seed: 13, throughput: 89, L: 3, Lq: 1, W: 2, Wq: 1, utilization: 0.69, availability: 1 },
    ],
  },
});
assert.equal(paired.statistical.find((entry) => entry.metric === 'throughput').conclusion, 'increase');
assert.equal(paired.statistical.find((entry) => entry.metric === 'Lq').conclusion, 'decrease');
assert.equal(paired.statistical.find((entry) => entry.metric === 'availability').conclusion, 'inconclusive');
assert.ok(paired.findings.some((finding) => /statistically supported decrease/.test(finding)));

assert.throws(() => compareMetrics({ before: {}, after: {} }), /structured block metrics/);
assert.throws(
  () => compareMetrics({ before: { blocks: [] }, after: { blocks: [] }, confidence: 1 }),
  /confidence/,
);

console.log('AI-COMPARE-METRICS TEST: PASS');
