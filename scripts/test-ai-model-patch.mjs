import assert from 'node:assert/strict';

import { proposeModelPatch, validateModelPatch } from './ai-model-patch.mjs';

const model = {
  name: 'Clinic',
  nodes: [
    { id: 'r1', kind: 'resource', name: 'Nurses', params: { capacity: 1 } },
    { id: 's1', kind: 'source', name: 'Patients', params: { arrival: 'rate(1)' } },
    { id: 'q1', kind: 'queue', name: 'Waiting', params: { capacity: 20 } },
    { id: 'w1', kind: 'service', name: 'Treat', params: { time: 'exponential(2)' } },
    { id: 'k1', kind: 'sink', name: 'Done', params: {} },
  ],
  edges: [],
};

const params = await proposeModelPatch({
  prompt: '将服务器数量改为 3，队列容量改为 50，到达率改为 0.8',
  model,
});
assert.equal(params.ok, true);
assert.equal(params.supported, true);
assert.deepEqual(params.patch.operations, [
  { op: 'update_block', target: 'q1', params: { capacity: 50 } },
  { op: 'update_block', target: 'r1', params: { capacity: 3 } },
  { op: 'update_block', target: 's1', params: { arrival: 'rate(0.8)' } },
]);

const structural = await proposeModelPatch({
  prompt: 'add sink Overflow and connect Waiting to Overflow',
  model,
});
assert.deepEqual(structural.patch.operations, [
  { op: 'add_block', kind: 'sink', name: 'Overflow' },
  { op: 'connect', from: 'q1', to: 'Overflow' },
]);

const addService = await proposeModelPatch({
  prompt: 'add service Review using Nurses with service rate 2.5',
  model,
});
assert.deepEqual(addService.patch.operations, [
  {
    op: 'add_block',
    kind: 'service',
    name: 'Review',
    params: { time: 'exponential(2.5)', resource: 'Nurses' },
  },
]);

const addQueue = await proposeModelPatch({
  prompt: 'add queue Overflow with capacity 7',
  model,
});
assert.deepEqual(addQueue.patch.operations, [
  { op: 'add_block', kind: 'queue', name: 'Overflow', params: { capacity: 7 } },
]);

const disconnect = await proposeModelPatch({
  prompt: 'disconnect Waiting from Done',
  model: { ...model, edges: [{ id: 'edge-1', from: 'q1', to: 'k1' }] },
});
assert.deepEqual(disconnect.patch.operations, [{ op: 'disconnect', edge: 'edge-1' }]);

const removal = await proposeModelPatch({ prompt: 'remove block Done', model });
assert.deepEqual(removal.patch.operations, [{ op: 'remove_block', target: 'k1' }]);

const unsupported = await proposeModelPatch({ prompt: 'make this model more realistic', model });
assert.equal(unsupported.supported, false);
assert.deepEqual(unsupported.patch.operations, []);

const ambiguous = await proposeModelPatch({
  prompt: 'set server capacity to 5',
  model: {
    ...model,
    nodes: [
      ...model.nodes,
      { id: 'r2', kind: 'resource', name: 'Doctors', params: { capacity: 2 } },
    ],
  },
});
assert.equal(ambiguous.supported, false, 'generic edits must not guess among equal block kinds');

const targeted = await proposeModelPatch({
  prompt: 'set Doctors server capacity to 5',
  model: {
    ...model,
    nodes: [
      ...model.nodes,
      { id: 'r2', kind: 'resource', name: 'Doctors', params: { capacity: 2 } },
    ],
  },
});
assert.deepEqual(targeted.patch.operations, [
  { op: 'update_block', target: 'r2', params: { capacity: 5 } },
]);

const followup = await proposeModelPatch({
  prompt: 'make it 4 instead',
  model,
  history: [{
    user: 'set Nurses server capacity to 3',
    patch: {
      version: 1,
      operations: [{ op: 'update_block', target: 'r1', params: { capacity: 3 } }],
    },
  }],
});
assert.deepEqual(followup.patch.operations, [
  { op: 'update_block', target: 'r1', params: { capacity: 4 } },
]);

const connectFollowup = await proposeModelPatch({
  prompt: 'connect it to Done',
  model: {
    ...model,
    nodes: [...model.nodes, { id: 'overflow-id', kind: 'sink', name: 'Overflow', params: {} }],
  },
  history: [{
    user: 'add sink Overflow',
    patch: { version: 1, operations: [{ op: 'add_block', kind: 'sink', name: 'Overflow' }] },
  }],
});
assert.deepEqual(connectFollowup.patch.operations, [
  { op: 'connect', from: 'overflow-id', to: 'k1' },
]);

assert.throws(
    () => validateModelPatch({
      version: 1,
      operations: [{ op: 'update_block', target: 'q1', params: { capacity: { unsafe: true } } }],
    }),
    /malformed update_block/);

console.log('AI-MODEL-PATCH TEST: PASS');
