// Server-side tests for the assistant step provider (scripts/ai-assistant.mjs).
// These cover the runtime schema validation and the tool registry contract
// without needing an LLM key; the live LLM path is exercised by the endpoint
// smoke test when OPENAI_API_KEY is present.
import assert from 'node:assert/strict';

import {
  ASSISTANT_TOOLS,
  buildSystemPrompt,
  resolveAssistantProvider,
  runAssistant,
  validateAssistantResponse,
} from './ai-assistant.mjs';

// Tool registry contract: the nine controlled tools the client executes.
const EXPECTED_TOOLS = [
  'inspect_model',
  'inspect_selection',
  'inspect_diagnostics',
  'inspect_run_metrics',
  'apply_model_patch',
  'compile_model',
  'run_simulation',
  'wait_for_run',
  'undo_last_ai_change',
];
assert.deepEqual(ASSISTANT_TOOLS.map((tool) => tool.name).sort(), [...EXPECTED_TOOLS].sort());
for (const tool of ASSISTANT_TOOLS) {
  assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
  assert.ok(tool.parameters && typeof tool.parameters === 'object');
}

// The prompt is executable contract. Lock down the exact patch vocabulary
// and first DES benchmark so the model does not have to guess fields or
// distribution semantics.
const systemPrompt = buildSystemPrompt();
for (const required of [
  'add_block',
  'update_block',
  'remove_block',
  'connect',
  'disconnect',
  'rename_model',
  'arrival":"rate(0.8)',
  'time":"exponential(1.0)',
  'arrival rate lambda < service rate mu',
  'ONE atomic patch',
  'cite only the metric values returned',
]) {
  assert.ok(systemPrompt.includes(required), `system prompt must include ${required}`);
}
assert.ok(systemPrompt.includes('刚才那个队列'));
assert.ok(systemPrompt.includes('检查模型'));
assert.equal(resolveAssistantProvider({ OPENAI_API_KEY: 'configured' }), 'api');
assert.equal(resolveAssistantProvider({ LOGICPILOT_AI_PROVIDER: 'codex' }), 'codex');
assert.equal(resolveAssistantProvider({}), 'unconfigured');
assert.throws(
  () => resolveAssistantProvider({ LOGICPILOT_AI_PROVIDER: 'unknown' }),
  /must be auto, api, or codex/,
);

// A valid response round-trips.
const valid = validateAssistantResponse({
  message: '检查模型',
  plan: [{ id: 's1', label: '检查模型' }],
  toolCalls: [{ id: 'call-1', name: 'inspect_model', arguments: {} }],
  done: false,
});
assert.equal(valid.message, '检查模型');
assert.equal(valid.toolCalls.length, 1);
assert.equal(valid.toolCalls[0].name, 'inspect_model');

// Malformed responses are rejected with readable errors, never crashes.
const cases = [
  [null, /object/],
  [{ message: 42, done: false }, /"message"/],
  [{ message: 'x', done: 'yes' }, /"done"/],
  [{ message: 'x', done: true, toolCalls: [{ id: 'c', name: 'inspect_model' }] }, /arguments/],
  [
    { message: 'x', done: false, toolCalls: [{ id: 'c', name: 'not_a_tool', arguments: {} }] },
    /not a known tool/,
  ],
  [
    { message: 'x', done: false, toolCalls: [{ id: 'c', name: 7, arguments: {} }] },
    /name must be a string/,
  ],
  [{ message: 'x', done: false, plan: [{ id: 1 }] }, /plan\[0\]/],
  [
    { message: 'x', done: true, toolCalls: [{ id: 'c', name: 'inspect_model', arguments: {} }] },
    /done but still proposes tool calls/,
  ],
  ['not json', /object/],
  [
    {
      message: 'x',
      done: false,
      toolCalls: [{ id: 'c', name: 'inspect_model', arguments: { unexpected: true } }],
    },
    /not allowed/,
  ],
  [
    {
      message: 'x',
      done: false,
      toolCalls: [{ id: 'c', name: 'apply_model_patch', arguments: { summary: 'x' } }],
    },
    /patch is required/,
  ],
  [
    {
      message: 'x',
      done: false,
      toolCalls: [
        {
          id: 'c',
          name: 'apply_model_patch',
          arguments: {
            summary: '',
            patch: { version: 1, operations: [] },
          },
        },
      ],
    },
    /summary must not be empty/,
  ],
  [
    {
      message: 'x',
      done: false,
      toolCalls: [
        { id: 'same', name: 'inspect_model', arguments: {} },
        { id: 'same', name: 'inspect_selection', arguments: {} },
      ],
    },
    /duplicated/,
  ],
];
for (const [input, pattern] of cases) {
  assert.throws(() => validateAssistantResponse(input), pattern);
}

// Provider compatibility: structured output is requested explicitly, while
// DeepSeek's default thinking mode is disabled for this routing endpoint.
const previousFetch = globalThis.fetch;
const previousEnvironment = Object.fromEntries(
  [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'OPENAI_MAX_TOKENS',
    'DEEPSEEK_THINKING',
  ].map((name) => [name, process.env[name]]),
);
let requestBody;
globalThis.fetch = async (_url, init) => {
  requestBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        { message: { content: '{"message":"done","plan":[],"toolCalls":[],"done":true}' } },
      ],
    }),
  };
};
process.env.OPENAI_API_KEY = 'test-only';
process.env.OPENAI_BASE_URL = 'https://api.deepseek.com';
process.env.OPENAI_MODEL = 'deepseek-v4-flash';
delete process.env.OPENAI_MAX_TOKENS;
await runAssistant({ messages: [{ role: 'user', content: 'test' }], context: {} });
assert.deepEqual(requestBody.response_format, { type: 'json_object' });
assert.deepEqual(requestBody.thinking, { type: 'disabled' });
assert.equal(requestBody.max_tokens, 4096);
process.env.DEEPSEEK_THINKING = 'sometimes';
await assert.rejects(
  () => runAssistant({ messages: [{ role: 'user', content: 'test' }], context: {} }),
  /must be enabled or disabled/,
);
globalThis.fetch = previousFetch;
for (const [name, value] of Object.entries(previousEnvironment)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log('AI-ASSISTANT TEST: PASS');
