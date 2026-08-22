import assert from 'node:assert/strict';

import { queryMetrics } from './ai-query-metrics.mjs';

const result = queryMetrics({
  question: 'where is the bottleneck?',
  metrics: {
    blocks: [
      {
        name: 'Waiting',
        kind: 'queue',
        mean_occupancy: 4.25,
        mean_wait: 2.5,
        utilization: 0,
        timed_out_mean: 2,
      },
      { name: 'Packing', kind: 'service', mean_occupancy: 0.9, mean_wait: 0.75, utilization: 0.92 },
      { name: 'Audit', kind: 'service', mean_occupancy: 0.2, utilization: 0.35 },
    ],
  },
  model: {
    nodes: [
      { id: 'source', kind: 'source', name: 'Arrivals' },
      { id: 'queue', kind: 'queue', name: 'Waiting' },
      { id: 'service', kind: 'service', name: 'Packing' },
    ],
    edges: [
      { from: 'source', to: 'queue' },
      { from: 'queue', to: 'service' },
    ],
  },
});
assert.equal(result.kind, 'metric-query');
assert.equal(result.evidence.busiestBlock, 'Packing');
assert.equal(result.evidence.largestQueue, 'Waiting');
assert.ok(result.findings.some((finding) => /92\.0%/.test(finding)));
assert.ok(result.findings.some((finding) => /timed-out/.test(finding)));
assert.deepEqual(result.evidence.causalChain, ['Arrivals', 'Waiting', 'Packing']);
assert.equal(result.evidence.causalEvidence.status, 'topology-supported');
assert.equal(result.evidence.causalEvidence.observations[1].meanOccupancy, 4.25);
assert.equal(result.evidence.causalEvidence.observations[1].meanWait, 2.5);
const queueRelationship = result.evidence.causalEvidence.relationships.find(
  (relationship) => relationship.from === 'Waiting' && relationship.to === 'Packing',
);
assert.ok(queueRelationship);
assert.ok(queueRelationship.signals.some((signal) => /upstream queue occupancy/.test(signal)));
assert.ok(queueRelationship.signals.some((signal) => /near saturation/.test(signal)));
assert.ok(result.findings.some((finding) => /stage wait/.test(finding)));
assert.ok(result.evidence.causalEvidence.caveat.includes('do not prove'));

assert.throws(
  () => queryMetrics({ question: 'why?', metrics: null }),
  /structured block metrics are required/,
);

console.log('AI-QUERY-METRICS TEST: PASS');
