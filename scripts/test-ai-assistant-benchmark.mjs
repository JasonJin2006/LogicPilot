// Offline tests for the live assistant benchmark's scoring and tool loop.
import assert from 'node:assert/strict';

import { evaluateMm1Transcript, inspectMm1Patch, runMm1Trial } from './benchmark-ai-assistant.mjs';

const validPatch = {
  version: 1,
  operations: [
    { op: 'add_block', kind: 'resource', name: 'Desk', params: { capacity: 1 } },
    { op: 'add_block', kind: 'source', name: 'In', params: { arrival: 'rate(0.80)' } },
    { op: 'add_block', kind: 'queue', name: 'Q', params: { capacity: 100 } },
    {
      op: 'add_block',
      kind: 'service',
      name: 'Serve',
      params: { resource: 'Desk', time: 'exponential(1)' },
    },
    { op: 'add_block', kind: 'sink', name: 'Out' },
    { op: 'connect', from: 'In', to: 'Q' },
    { op: 'connect', from: 'Q', to: 'Serve' },
    { op: 'connect', from: 'Serve', to: 'Out' },
  ],
};

assert.equal(inspectMm1Patch(validPatch).valid, true);
assert.equal(
  inspectMm1Patch({
    ...validPatch,
    operations: validPatch.operations.filter((operation) => operation.kind !== 'sink'),
  }).valid,
  false,
);

const happyResponses = [
  {
    message: 'building',
    done: false,
    toolCalls: [
      {
        id: 'build',
        name: 'apply_model_patch',
        arguments: { summary: 'build M/M/1', patch: validPatch },
      },
    ],
  },
  {
    message: 'running',
    done: false,
    toolCalls: [{ id: 'run', name: 'run_simulation', arguments: {} }],
  },
  {
    message: 'Wq is 4.0, Lq is 3.2 and utilization is 80%.',
    done: true,
    toolCalls: [],
  },
];
assert.deepEqual(evaluateMm1Transcript(happyResponses).criteria, {
  oneAtomicCompletePatch: true,
  correctMm1Parameters: true,
  correctFlowTopology: true,
  requestedSimulationRun: true,
  groundedFinalAnswer: true,
  consistentExplanation: true,
});
assert.equal(evaluateMm1Transcript(happyResponses).passed, true);

const hallucinated = evaluateMm1Transcript([
  happyResponses[0],
  {
    message: 'The example should be stable because utilization is 0.8.',
    done: true,
    toolCalls: [],
  },
]);
assert.equal(hallucinated.criteria.requestedSimulationRun, false);
assert.equal(hallucinated.criteria.groundedFinalAnswer, false);
assert.equal(hallucinated.passed, false);

const contradictory = evaluateMm1Transcript([
  happyResponses[0],
  happyResponses[1],
  {
    message: 'Wq=4.0 and utilization=0.8, but Lq=4 contradicts the returned evidence.',
    done: true,
    toolCalls: [],
  },
]);
assert.equal(contradictory.criteria.groundedFinalAnswer, true);
assert.equal(contradictory.criteria.consistentExplanation, false);
assert.equal(contradictory.passed, false);

let responseIndex = 0;
const loopResult = await runMm1Trial({
  runStep: async () => happyResponses[responseIndex++],
});
assert.equal(loopResult.passed, true);
assert.equal(loopResult.responses, 3);

console.log('AI-ASSISTANT BENCHMARK TEST: PASS');
