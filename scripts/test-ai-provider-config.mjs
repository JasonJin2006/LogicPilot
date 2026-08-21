import assert from 'node:assert/strict';

import {
  listProviderModels,
  requestProviderResponse,
  requestProviderStream,
  requestProviderText,
} from './ai-provider-adapters.mjs';
import { testAssistantConnection } from './ai-assistant.mjs';
import {
  AI_PROVIDER_PRESETS,
  AI_PROTOCOLS,
  clearAssistantProviderSession,
  configureAssistantProvider,
  getAssistantProviderState,
  resolveAssistantConfiguration,
  resolveAssistantConfigurationForModelList,
} from './ai-provider-config.mjs';

assert.ok(AI_PROVIDER_PRESETS.length >= 20);
assert.deepEqual(
  new Set(AI_PROTOCOLS.map((item) => item.id)),
  new Set([
    'openai-chat',
    'openai-responses',
    'anthropic-messages',
    'google-gemini',
    'codex-app-server',
  ]),
);
configureAssistantProvider({
  providerId: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'secret-test-value',
});
const state = getAssistantProviderState({});
assert.equal(state.active.providerId, 'deepseek');
assert.equal(state.active.hasApiKey, true);
assert.equal(JSON.stringify(state).includes('secret-test-value'), false);
assert.throws(
  () =>
    configureAssistantProvider({
      providerId: 'openai',
      baseUrl: 'file:///tmp/nope',
      model: 'x',
      apiKey: 'x',
    }),
  /http\(s\)/,
);
assert.equal(
  resolveAssistantConfigurationForModelList({
    providerId: 'custom',
    baseUrl: 'http://custom/v1',
  }).model,
  '',
);

const previousFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init, body: JSON.parse(init.body) });
  const protocol = requests.length;
  const payload =
    protocol === 1
      ? { choices: [{ message: { content: '{"ok":1}' } }] }
      : protocol === 2
        ? { output: [{ content: [{ type: 'output_text', text: '{"ok":2}' }] }] }
        : protocol === 3
          ? { content: [{ type: 'text', text: '{"ok":3}' }] }
          : { candidates: [{ content: { parts: [{ text: '{"ok":4}' }] } }] };
  return { ok: true, status: 200, json: async () => payload };
};
const common = { system: 'system', userContent: 'user', maxTokens: 512, maxResponseBytes: 1024 };
assert.equal(
  await requestProviderText(
    {
      providerId: 'custom',
      protocol: 'openai-chat',
      baseUrl: 'http://chat/v1',
      model: 'm',
      apiKey: 'k',
    },
    common,
  ),
  '{"ok":1}',
);
assert.equal(
  await requestProviderText(
    {
      providerId: 'openai',
      protocol: 'openai-responses',
      baseUrl: 'http://responses/v1',
      model: 'm',
      apiKey: 'k',
    },
    common,
  ),
  '{"ok":2}',
);
assert.equal(
  await requestProviderText(
    {
      providerId: 'anthropic',
      protocol: 'anthropic-messages',
      baseUrl: 'http://anthropic/v1',
      model: 'm',
      apiKey: 'k',
    },
    common,
  ),
  '{"ok":3}',
);
assert.equal(
  await requestProviderText(
    {
      providerId: 'google',
      protocol: 'google-gemini',
      baseUrl: 'http://gemini/v1beta',
      model: 'models/a/b',
      apiKey: 'k',
    },
    common,
  ),
  '{"ok":4}',
);
assert.equal(requests[0].url, 'http://chat/v1/chat/completions');
assert.equal(requests[1].body.store, false);
assert.equal(requests[2].init.headers['anthropic-version'], '2023-06-01');
assert.equal(requests[3].init.headers['x-goog-api-key'], 'k');
assert.match(requests[3].url, /models\/a%2Fb:generateContent$/);

let modelListRequest;
globalThis.fetch = async (url, init) => {
  modelListRequest = { url: String(url), init };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ id: 'qwen3' }, { id: 'qwen3' }, { id: 'qwen2.5-coder:latest' }],
    }),
  };
};
assert.deepEqual(
  await listProviderModels({
    providerId: 'ollama',
    protocol: 'openai-chat',
    baseUrl: 'http://ollama/v1',
    model: 'qwen3',
  }),
  ['qwen3', 'qwen2.5-coder:latest'],
);
assert.equal(modelListRequest.url, 'http://ollama/v1/models');
assert.equal(modelListRequest.init.method, 'GET');

let nativeBody;
globalThis.fetch = async (_url, init) => {
  nativeBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [{ id: 'native-1', function: { name: 'inspect_model', arguments: '{}' } }],
          },
        },
      ],
    }),
  };
};
const native = await requestProviderResponse(
  {
    providerId: 'ollama',
    protocol: 'openai-chat',
    baseUrl: 'http://ollama/v1',
    model: 'qwen3',
    nativeTools: true,
  },
  {
    ...common,
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
assert.deepEqual(native.nativeToolCalls, [
  { id: 'native-1', name: 'inspect_model', arguments: {} },
]);
assert.equal(nativeBody.response_format, undefined);
assert.equal(nativeBody.tools[0].function.name, 'inspect_model');

// Providers that omit native ids still produce pairable, unique calls.
globalThis.fetch = async (_url, init) => {
  nativeBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id: ' ', function: { name: 'inspect_model', arguments: '{}' } },
              { id: '', function: { name: 'inspect_selection', arguments: '{}' } },
            ],
          },
        },
      ],
    }),
  };
};
const missingNativeIds = await requestProviderResponse(
  {
    providerId: 'ollama',
    protocol: 'openai-chat',
    baseUrl: 'http://ollama/v1',
    model: 'qwen3',
    nativeTools: true,
  },
  {
    ...common,
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'inspect_selection',
          description: 'selection',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
assert.deepEqual(
  missingNativeIds.nativeToolCalls.map((call) => call.id),
  ['inspect_model-native-1', 'inspect_selection-native-2'],
);
globalThis.fetch = async (_url, init) => {
  nativeBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        { type: 'function_call', call_id: 'responses-1', name: 'inspect_model', arguments: '{}' },
      ],
    }),
  };
};
const responsesNative = await requestProviderResponse(
  {
    providerId: 'openai',
    protocol: 'openai-responses',
    baseUrl: 'http://responses/v1',
    model: 'gpt-5',
    apiKey: 'k',
    nativeTools: true,
  },
  {
    ...common,
    conversationMessages: [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'responses-0', name: 'inspect_model', arguments: {} }],
        toolResults: [{ toolCallId: 'responses-0', ok: true, result: { nodes: 0 } }],
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
assert.deepEqual(responsesNative.nativeToolCalls, [
  { id: 'responses-1', name: 'inspect_model', arguments: {} },
]);
assert.equal(nativeBody.tools[0].name, 'inspect_model');
assert.equal(nativeBody.tools[0].function, undefined);
const responseOutput = nativeBody.input.find((item) => item.type === 'function_call_output');
assert.equal(responseOutput.call_id, 'responses-0');

await requestProviderResponse(
  {
    providerId: 'ollama',
    protocol: 'openai-chat',
    baseUrl: 'http://ollama/v1',
    model: 'qwen3',
    nativeTools: true,
  },
  {
    ...common,
    conversationMessages: [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'native-1', name: 'inspect_model', arguments: {} }],
        toolResults: [{ toolCallId: 'native-1', ok: true, result: { nodes: 0 } }],
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
assert.deepEqual(
  nativeBody.messages.map((message) => message.role),
  ['system', 'user', 'assistant', 'tool', 'user'],
);
assert.equal(nativeBody.messages[3].tool_call_id, 'native-1');

globalThis.fetch = async (_url, init) => {
  nativeBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'tool_use', id: 'anthropic-1', name: 'inspect_model', input: {} }],
    }),
  };
};
const anthropicNative = await requestProviderResponse(
  {
    providerId: 'anthropic',
    protocol: 'anthropic-messages',
    baseUrl: 'http://anthropic/v1',
    model: 'claude',
    apiKey: 'k',
    nativeTools: true,
  },
  {
    ...common,
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
assert.deepEqual(anthropicNative.nativeToolCalls, [
  { id: 'anthropic-1', name: 'inspect_model', arguments: {} },
]);
assert.equal(nativeBody.tools[0].name, 'inspect_model');

globalThis.fetch = async (_url, init) => {
  nativeBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ functionCall: { name: 'inspect_model', args: {} } }] } }],
    }),
  };
};
await requestProviderResponse(
  {
    providerId: 'google',
    protocol: 'google-gemini',
    baseUrl: 'http://gemini/v1beta',
    model: 'gemini-2.5-pro',
    apiKey: 'k',
    nativeTools: true,
  },
  {
    ...common,
    conversationMessages: [
      { role: 'user', content: 'inspect' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 'gemini-0', name: 'inspect_model', arguments: {} }],
        toolResults: [{ toolCallId: 'gemini-0', ok: true, result: { nodes: 0 } }],
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
  },
);
const geminiResult = nativeBody.contents.find((item) => item.role === 'user' && item.parts.some((part) => part.functionResponse));
const geminiResponse = geminiResult.parts.find((part) => part.functionResponse).functionResponse;
assert.equal(geminiResponse.name, 'inspect_model');
assert.equal(geminiResponse.id, 'gemini-0');
const encoder = new TextEncoder();
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi "}}]}\n\n'));
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"stream-call","function":{"name":"inspect_model","arguments":"{}"}}]}}]}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }),
});
const streamDeltas = [];
const streamed = await requestProviderStream(
  {
    providerId: 'ollama',
    protocol: 'openai-chat',
    baseUrl: 'http://ollama/v1',
    model: 'qwen3',
    nativeTools: true,
  },
  {
    ...common,
    tools: [
      {
        type: 'function',
        function: {
          name: 'inspect_model',
          description: 'inspect',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ],
    onChunk: (chunk) => streamDeltas.push(chunk),
  },
);
assert.equal(streamed.text, 'hi ');
assert.equal(streamed.nativeToolCalls[0].id, 'stream-call');
assert.equal(streamDeltas[0].delta, 'hi ');

// Settings can test a draft provider without first mutating the active
// session, and the probe does not send assistant tools.
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(body.messages.at(-1).content, 'connection test');
  assert.equal(body.tools, undefined);
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'connection ready' } }] }),
  };
};
const connection = await testAssistantConnection({
  provider: {
    providerId: 'custom',
    protocol: 'openai-chat',
    baseUrl: 'http://draft/v1',
    model: 'draft-model',
    apiKey: 'draft-key',
  },
});
assert.deepEqual(connection, { providerId: 'custom', protocol: 'openai-chat' });
clearAssistantProviderSession();
const ollamaEnvironment = resolveAssistantConfiguration({
  LOGICPILOT_AI_PROVIDER: 'ollama',
  LOGICPILOT_AI_MODEL: 'qwen2.5-coder:latest',
});
assert.equal(ollamaEnvironment.providerId, 'ollama');
assert.equal(ollamaEnvironment.apiKey, '');

globalThis.fetch = previousFetch;
clearAssistantProviderSession();
console.log('AI-PROVIDER-CONFIG TEST: PASS');
