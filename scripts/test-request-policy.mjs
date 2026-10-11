import assert from 'node:assert/strict';

import {
  API_MAX_CONCURRENT_REQUESTS,
  API_REQUEST_TIMEOUT_MS,
  REQUEST_CANCEL_SIGNAL,
  createApiRequestPolicy,
} from '../app/request-policy.mjs';

function responseStub() {
  const headers = new Map();
  return {
    headers,
    headersSent: false,
    writableEnded: false,
    status: 0,
    body: '',
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(status) {
      this.status = status;
      this.headersSent = true;
    },
    end(body = '') {
      this.body = body;
      this.writableEnded = true;
    },
  };
}

const policy = createApiRequestPolicy({ maxConcurrent: 2, timeoutMs: 500 });
let release;
const blocker = new Promise((resolve) => {
  release = resolve;
});

const activeRequests = Array.from({ length: API_MAX_CONCURRENT_REQUESTS }, async () => {
  const response = responseStub();
  await policy({}, response, async () => blocker);
  return response;
});

await new Promise((resolve) => setTimeout(resolve, 10));
const saturated = responseStub();
await policy({}, saturated, async () => undefined);
assert.equal(saturated.status, 429);
assert.equal(saturated.headers.get('retry-after'), '5');
release();
await Promise.all(activeRequests);

const timeoutPolicy = createApiRequestPolicy({ maxConcurrent: 1, timeoutMs: 5 });
const cancelReq = {};
const timedOut = responseStub();
let cancelSignal = null;
await timeoutPolicy(cancelReq, timedOut, async () => {
  cancelSignal = cancelReq[REQUEST_CANCEL_SIGNAL];
  await new Promise((resolve) => setTimeout(resolve, API_REQUEST_TIMEOUT_MS / 100));
});
assert.equal(timedOut.status, 504);
// The request carries a cancellation signal and the timeout aborts it, so
// handlers can cancel the work behind the 504 instead of leaking it.
assert.ok(cancelSignal instanceof AbortSignal);
assert.equal(cancelSignal.aborted, true);

console.log('REQUEST-POLICY TEST: PASS');
