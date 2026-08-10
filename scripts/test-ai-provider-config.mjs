import assert from 'node:assert/strict';

import { requestProviderText } from './ai-provider-adapters.mjs';
import {
  AI_PROVIDER_PRESETS,
  AI_PROTOCOLS,
  clearAssistantProviderSession,
  configureAssistantProvider,
  getAssistantProviderState,
} from './ai-provider-config.mjs';

assert.ok(AI_PROVIDER_PRESETS.length >= 20);
assert.deepEqual(new Set(AI_PROTOCOLS.map((item) => item.id)), new Set([
  'openai-chat', 'openai-responses', 'anthropic-messages', 'google-gemini', 'codex-app-server',
]));
configureAssistantProvider({ providerId: 'deepseek', model: 'deepseek-chat', apiKey: 'secret-test-value' });
const state = getAssistantProviderState({});
assert.equal(state.active.providerId, 'deepseek');
assert.equal(state.active.hasApiKey, true);
assert.equal(JSON.stringify(state).includes('secret-test-value'), false);
assert.throws(() => configureAssistantProvider({ providerId: 'openai', baseUrl: 'file:///tmp/nope', model: 'x', apiKey: 'x' }), /http\(s\)/);

const previousFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init, body: JSON.parse(init.body) });
  const protocol = requests.length;
  const payload = protocol === 1
    ? { choices: [{ message: { content: '{"ok":1}' } }] }
    : protocol === 2
      ? { output: [{ content: [{ type: 'output_text', text: '{"ok":2}' }] }] }
      : protocol === 3
        ? { content: [{ type: 'text', text: '{"ok":3}' }] }
        : { candidates: [{ content: { parts: [{ text: '{"ok":4}' }] } }] };
  return { ok: true, status: 200, json: async () => payload };
};
const common = { system: 'system', userContent: 'user', maxTokens: 512, maxResponseBytes: 1024 };
assert.equal(await requestProviderText({ providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://chat/v1', model: 'm', apiKey: 'k' }, common), '{"ok":1}');
assert.equal(await requestProviderText({ providerId: 'openai', protocol: 'openai-responses', baseUrl: 'http://responses/v1', model: 'm', apiKey: 'k' }, common), '{"ok":2}');
assert.equal(await requestProviderText({ providerId: 'anthropic', protocol: 'anthropic-messages', baseUrl: 'http://anthropic/v1', model: 'm', apiKey: 'k' }, common), '{"ok":3}');
assert.equal(await requestProviderText({ providerId: 'google', protocol: 'google-gemini', baseUrl: 'http://gemini/v1beta', model: 'models/a/b', apiKey: 'k' }, common), '{"ok":4}');
assert.equal(requests[0].url, 'http://chat/v1/chat/completions');
assert.equal(requests[1].body.store, false);
assert.equal(requests[2].init.headers['anthropic-version'], '2023-06-01');
assert.equal(requests[3].init.headers['x-goog-api-key'], 'k');
assert.match(requests[3].url, /models\/a%2Fb:generateContent$/);

globalThis.fetch = previousFetch;
clearAssistantProviderSession();
console.log('AI-PROVIDER-CONFIG TEST: PASS');
