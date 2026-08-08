// Regression test for the AI build endpoint (vite dev middleware handler):
// POST /api/ai-build returns the loop result (dsl + run summary); invalid
// bodies are rejected. Requires lpcli (--lpcli <path> or LPCLI env).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import {
  handleAiBuild,
  handleAiCompareMetrics,
  handleAiExplain,
  handleAiOptimize,
  handleAiPatch,
  handleAiQueryMetrics,
  handleAiRun,
  handleAiValidate,
  handleParameterVariation,
} from './ai-endpoint.mjs';

const flag = process.argv.indexOf('--lpcli');
if (flag >= 0 && process.argv[flag + 1]) {
  process.env.LPCLI = process.argv[flag + 1];
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/parameter-variation')) {
    void handleParameterVariation(req, res);
  } else if (req.url?.startsWith('/api/ai-compare-metrics')) {
    void handleAiCompareMetrics(req, res);
  } else if (req.url?.startsWith('/api/ai-run')) {
    void handleAiRun(req, res);
  } else if (req.url?.startsWith('/api/ai-validate')) {
    void handleAiValidate(req, res);
  } else if (req.url?.startsWith('/api/ai-patch')) {
    void handleAiPatch(req, res);
  } else if (req.url?.startsWith('/api/ai-query-metrics')) {
    void handleAiQueryMetrics(req, res);
  } else if (req.url?.startsWith('/api/ai-optimize')) {
    void handleAiOptimize(req, res);
  } else if (req.url?.startsWith('/api/ai-explain')) {
    void handleAiExplain(req, res);
  } else {
    void handleAiBuild(req, res);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/ai-build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt:
          'build an M/M/1 queue model with arrival rate 0.8 and service ' +
          'rate 1.0',
      run: true,
    }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.ok(data.iterations >= 1);
  assert.match(data.dsl, /rate\(0\.8\)/);
  assert.match(data.dsl, /exponential\(1\.0\)/);
  assert.match(data.runSummary ?? '', /summary:/);
  assert.ok(Array.isArray(data.metrics?.blocks));
  assert.ok(data.metrics.blocks.some((block) => block.kind === 'queue'));

  // Existing-model interaction must preserve unrelated topology instead of
  // replacing the canvas with the provider's default queue template.
  const contextDsl = `model ExistingLine {
  use process
  resource Staff { capacity = 1 }
  source Orders { arrival = rate(0.5) }
  queue Backlog { capacity = 20 }
  service Pack { resource = Staff time = exponential(1) }
  delay Audit { delayTime = constant(0.25) capacity = 4 }
  sink Done { }
  couple Orders.out -> Backlog.in
  couple Backlog.out -> Pack.in
  couple Pack.out -> Audit.in
  couple Audit.out -> Done.in
}
`;
  const edit = await fetch(`http://127.0.0.1:${port}/api/ai-build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'set server capacity to 3 and queue capacity to 8',
      contextDsl,
      run: false,
    }),
  });
  assert.equal(edit.status, 200);
  const editData = await edit.json();
  assert.equal(editData.ok, true);
  assert.match(editData.dsl, /resource Staff \{ capacity = 3 \}/);
  assert.match(editData.dsl, /queue Backlog \{ capacity = 8 \}/);
  assert.match(editData.dsl, /delay Audit/);
  assert.match(editData.dsl, /couple Audit\.out -> Done\.in/);

  const patchResponse = await fetch(`http://127.0.0.1:${port}/api/ai-patch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'set server capacity to 4 and add sink Overflow',
      model: {
        name: 'ExistingLine',
        nodes: [
          { id: 'staff-id', kind: 'resource', name: 'Staff', params: { capacity: 1 } },
          { id: 'done-id', kind: 'sink', name: 'Done', params: {} },
        ],
        edges: [],
      },
    }),
  });
  assert.equal(patchResponse.status, 200);
  const patchData = await patchResponse.json();
  assert.equal(patchData.ok, true);
  assert.equal(patchData.supported, true);
  assert.deepEqual(patchData.patch.operations, [
    { op: 'update_block', target: 'staff-id', params: { capacity: 4 } },
    { op: 'add_block', kind: 'sink', name: 'Overflow' },
  ]);

  const followupPatch = await fetch(`http://127.0.0.1:${port}/api/ai-patch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'make it 6 instead',
      model: {
        name: 'ExistingLine',
        nodes: [{ id: 'staff-id', kind: 'resource', name: 'Staff', params: { capacity: 4 } }],
        edges: [],
      },
      history: [{ user: 'set server capacity to 4', patch: patchData.patch }],
    }),
  });
  assert.equal(followupPatch.status, 200);
  assert.deepEqual((await followupPatch.json()).patch.operations, [
    { op: 'update_block', target: 'staff-id', params: { capacity: 6 } },
  ]);

  const validation = await fetch(`http://127.0.0.1:${port}/api/ai-validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl: editData.dsl }),
  });
  assert.equal(validation.status, 200);
  const validationData = await validation.json();
  assert.equal(validationData.ok, true);
  assert.deepEqual(validationData.diagnostics, []);

  // The run tool executes the exact accepted canvas DSL without asking the
  // provider to regenerate it again.
  const exactRun = await fetch(`http://127.0.0.1:${port}/api/ai-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dsl: editData.dsl,
      seed: 7,
      reps: 2,
      arrivals: 100,
      warmup: 0,
      confidence: 0.9,
    }),
  });
  assert.equal(exactRun.status, 200);
  const exactRunData = await exactRun.json();
  assert.equal(exactRunData.ok, true);
  assert.match(exactRunData.runSummary, /summary:/);
  assert.deepEqual(exactRunData.experiment, {
    seed: 7,
    seedMode: 'fixed',
    reps: 2,
    replicationMode: 'fixed',
    minReps: 5,
    maxReps: 100,
    errorPercent: 5,
    precisionMetric: 'Wq',
    arrivals: 100,
    warmup: 0,
    confidence: 0.9,
  });
  assert.equal(exactRunData.metrics.replications.length, 2);
  assert.ok(Number.isFinite(exactRunData.metrics.summary.Wq.ci_low));
  assert.ok(exactRunData.metrics.blocks.some((block) => block.name === 'Audit'));

  const query = await fetch(`http://127.0.0.1:${port}/api/ai-query-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: 'where is the bottleneck?',
      metrics: exactRunData.metrics,
    }),
  });
  assert.equal(query.status, 200);
  const queryData = await query.json();
  assert.equal(queryData.kind, 'metric-query');
  assert.ok(queryData.evidence.blockCount > 0);
  assert.ok(queryData.findings.length > 0);

  const comparison = await fetch(`http://127.0.0.1:${port}/api/ai-compare-metrics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ before: data.metrics, after: exactRunData.metrics }),
  });
  assert.equal(comparison.status, 200);
  const comparisonData = await comparison.json();
  assert.equal(comparisonData.kind, 'metric-comparison');
  assert.ok(Array.isArray(comparisonData.blocks));
  assert.ok(comparisonData.findings.length > 0);

  const invalidExperiment = await fetch(`http://127.0.0.1:${port}/api/ai-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl: editData.dsl, arrivals: 10, warmup: 10 }),
  });
  assert.equal(invalidExperiment.status, 400);
  assert.match((await invalidExperiment.json()).error, /warmup must be < arrivals/);

  const invalidRun = await fetch(`http://127.0.0.1:${port}/api/ai-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dsl: 'not a model' }),
  });
  assert.equal(invalidRun.status, 200);
  const invalidRunData = await invalidRun.json();
  assert.equal(invalidRunData.ok, false);
  assert.ok(invalidRunData.diagnostics.length > 0);

  const bad = await fetch(`http://127.0.0.1:${port}/api/ai-build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(bad.status, 400);

  // Optimization endpoint: POST /api/ai-optimize returns the search result.
  const opt = await fetch(`http://127.0.0.1:${port}/api/ai-optimize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt:
          'minimize Wq over servers 1..4 for an M/M/1 queue with arrival ' +
          '0.8 and service 1.0',
    }),
  });
  assert.equal(opt.status, 200);
  const optData = await opt.json();
  assert.equal(optData.kind, 'optimize');
  assert.equal(optData.variable, 'servers');
  assert.equal(optData.best.value, 4);

  // Explain endpoint: prompt -> metrics + findings.
  const explain = await fetch(`http://127.0.0.1:${port}/api/ai-explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt:
          'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0',
      question: 'why is the queue slow?',
    }),
  });
  assert.equal(explain.status, 200);
  const explainData = await explain.json();
  assert.equal(explainData.kind, 'explain');
  assert.ok(explainData.findings.length >= 1);
  assert.ok(Number.isFinite(explainData.metrics.availability));

  // A declared multi-axis experiment must traverse the complete Cartesian
  // product through the same HTTP boundary used by the IDE.
  const variationResponse = await fetch(
    `http://127.0.0.1:${port}/api/parameter-variation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dsl: readFileSync(
          new URL('../../../../examples/des-parameter-variation.lp', import.meta.url),
          'utf8',
        ),
        experimentName: 'CapacityStudy',
        arrivals: 300,
        warmup: 30,
        concurrency: 2,
      }),
    },
  );
  assert.equal(variationResponse.status, 200);
  const variationData = await variationResponse.json();
  assert.equal(variationData.ok, true);
  assert.equal(variationData.kind, 'parameter_variation');
  assert.equal(variationData.pointCount, 4);
  assert.deepEqual(
    variationData.iterations.map((iteration) => iteration.parameters),
    [
      { arrival_rate: 0.6, server_count: 1 },
      { arrival_rate: 0.6, server_count: 2 },
      { arrival_rate: 0.8, server_count: 1 },
      { arrival_rate: 0.8, server_count: 2 },
    ],
  );
  assert.ok(variationData.iterations.every(
    (iteration) => iteration.metrics.replications.length === 2,
  ));

  console.log('AI-ENDPOINT TEST: PASS');
} finally {
  server.close();
}
