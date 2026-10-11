import assert from 'node:assert/strict';
import { assessRuntimeResult, replayMatches } from './runtime-conformance.mjs';
const valid = {
  metrics: {
    replications: [{ arrivals: 5, horizon_seconds: 5 }],
    summary: { utilization: { mean: 0.8 } },
  },
};
assert.equal(assessRuntimeResult('process', valid).conformance.passed, true);
const bad = structuredClone(valid);
bad.metrics.summary.utilization.mean = NaN;
assert.equal(assessRuntimeResult('process', bad).conformance.passed, false);
assert.equal(
  assessRuntimeResult('continuous', {
    ...valid,
    trajectory: { points: [{ t: 0, values: [Infinity] }] },
  }).conformance.passed,
  false,
);
assert.equal(
  assessRuntimeResult('continuous', {
    ...valid,
    trajectory: {
      points: [
        { t: 2, values: [1] },
        { t: 1, values: [1] },
      ],
    },
  }).conformance.passed,
  false,
);
const first = { ok: true, methods: ['agent'], metrics: { a: 1, b: 2 }, trajectory: null };
assert.equal(replayMatches(first, { ...first, metrics: { b: 2, a: 1 } }), true);
assert.equal(replayMatches(first, { ...first, metrics: { a: 1, b: 3 } }), false);
assert.equal(
  assessRuntimeResult('devs', { ...valid, logicalTraceBytes: 24 }).details.summary.traceStatus,
  'transition-trace-not-exported',
);
console.log('RUNTIME-CONFORMANCE TEST: PASS');
