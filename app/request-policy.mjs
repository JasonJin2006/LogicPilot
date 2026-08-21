// Shared request policy for the local app server and the Vite development API.
// The API is intentionally local-only; these limits are still useful because
// a browser extension or another local process can reach a loopback port.

export const API_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const API_REQUEST_TIMEOUT_MS = 120_000;
export const API_MAX_CONCURRENT_REQUESTS = 4;

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

/** Create a bounded, fail-fast gate for expensive API requests. */
export function createApiRequestPolicy({
  maxConcurrent = API_MAX_CONCURRENT_REQUESTS,
  timeoutMs = API_REQUEST_TIMEOUT_MS,
} = {}) {
  let active = 0;

  return async function runWithApiPolicy(req, res, handler) {
    if (active >= maxConcurrent) {
      res.setHeader('retry-after', '5');
      sendJson(res, 429, { ok: false, error: 'too many concurrent API requests' });
      return;
    }

    active += 1;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      sendJson(res, 504, { ok: false, error: 'API request timed out' });
    }, timeoutMs);

    try {
      await handler();
    } catch (error) {
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    } finally {
      clearTimeout(timer);
      active -= 1;
      // Keep the variable explicit so future handlers can attach cancellation
      // to the request without changing the policy contract.
      void timedOut;
    }
  };
}
