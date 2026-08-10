import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { handleAiProviders } from '../web/apps/ide/scripts/ai-endpoint.mjs';
import { clearAssistantProviderSession } from './ai-provider-config.mjs';

const server = createServer((req, res) => void handleAiProviders(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
try {
  const initial = await fetch(`http://127.0.0.1:${port}/api/ai-providers`);
  assert.equal(initial.status, 200);
  assert.ok((await initial.json()).providers.length >= 20);

  const saved = await fetch(`http://127.0.0.1:${port}/api/ai-providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'ollama', model: 'qwen3', apiKey: 'must-not-leak' }),
  });
  assert.equal(saved.status, 200);
  const body = await saved.text();
  assert.equal(body.includes('must-not-leak'), false);
  assert.equal(JSON.parse(body).active.configured, true);
} finally {
  clearAssistantProviderSession();
  server.close();
}
console.log('AI-PROVIDER-ENDPOINT TEST: PASS');
