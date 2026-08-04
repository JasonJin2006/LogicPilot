// Regression test for the AI build endpoint (vite dev middleware handler):
// POST /api/ai-build returns the loop result (dsl + run summary); invalid
// bodies are rejected. Requires lpcli (--lpcli <path> or LPCLI env).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { handleAiBuild, handleAiOptimize } from './ai-endpoint.mjs';

const flag = process.argv.indexOf('--lpcli');
if (flag >= 0 && process.argv[flag + 1]) {
  process.env.LPCLI = process.argv[flag + 1];
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/ai-optimize')) {
    void handleAiOptimize(req, res);
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
  assert.match(data.dsl, /poisson\(0\.8\)/);
  assert.match(data.dsl, /exponential\(1\.0\)/);
  assert.match(data.runSummary ?? '', /summary:/);

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

  console.log('AI-ENDPOINT TEST: PASS');
} finally {
  server.close();
}
