import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { handleAiAssistantStream } from '../web/apps/ide/scripts/ai-endpoint.mjs';
import {
  clearAssistantProviderSession,
  configureAssistantProvider,
} from './ai-provider-config.mjs';

configureAssistantProvider({
  providerId: 'ollama',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5-coder:latest',
});
const server = createServer((req, res) => void handleAiAssistantStream(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
try {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Inspect the current model. Use the inspect_model tool.' },
      ],
      context: {
        project: 'Stream smoke',
        modelSummary: 'model M nodes (0):',
        selection: 'nothing selected',
        dsl: '',
        diagnostics: 'none',
        runStatus: 'none',
        runMetrics: 'none',
      },
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"type":"done"/);
} finally {
  clearAssistantProviderSession();
  server.close();
}
console.log('ASSISTANT SSE SMOKE: PASS');
