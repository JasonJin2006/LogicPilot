import assert from 'node:assert/strict';

import {
  clearAssistantProviderSession,
  configureAssistantProvider,
} from './ai-provider-config.mjs';
import { proposeModelPatch } from './ai-model-patch.mjs';

configureAssistantProvider({
  providerId: 'ollama',
  protocol: 'openai-chat',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5-coder:latest',
});
try {
  const result = await proposeModelPatch({
    prompt: 'set queue Waiting capacity to 40',
    model: {
      name: 'Clinic',
      nodes: [{ id: 'q1', kind: 'queue', name: 'Waiting', params: { capacity: 20 } }],
      edges: [],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'ollama');
  assert.ok(result.patch.operations.length > 0);
} finally {
  clearAssistantProviderSession();
}
console.log('OLLAMA MODEL-PATCH SMOKE: PASS');
