// Server-side tests for the assistant step provider (scripts/ai-assistant.mjs).
// These cover the runtime schema validation and the tool registry contract
// without needing an LLM key; the live LLM path is exercised by the endpoint
// smoke test when OPENAI_API_KEY is present.
import assert from 'node:assert/strict';

import {
  ASSISTANT_TOOLS,
  buildSystemPrompt,
  parseAssistantResponseContent,
  visibleAssistantMessage,
  resolveAssistantProvider,
  runAssistant,
  validateAssistantMessages,
  validateAssistantResponse,
} from './ai-assistant.mjs';
import {
  clearAssistantProviderSession,
  configureAssistantProvider,
} from './ai-provider-config.mjs';

// Tool registry contract: the nine controlled tools the client executes.
const EXPECTED_TOOLS = [
  'inspect_model',
  'inspect_selection',
  'inspect_diagnostics',
  'inspect_run_metrics',
  'run_parameter_study',
  'explain_results',
  'optimize_model',
  'compare_runs',
  'apply_model_patch',
  'compile_model',
  'run_simulation',
  'wait_for_run',
  'undo_last_ai_change',
  'read_workspace_file',
  'apply_source_patch',
];
assert.deepEqual(ASSISTANT_TOOLS.map((tool) => tool.name).sort(), [...EXPECTED_TOOLS].sort());
for (const tool of ASSISTANT_TOOLS) {
  assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
  assert.ok(tool.parameters && typeof tool.parameters === 'object');
}

assert.equal(validateAssistantMessages([{ role: 'user', content: 'inspect' }]), null);
assert.equal(
  validateAssistantMessages([
    {
      role: 'assistant',
      content: 'calling',
      toolCalls: [{ id: 'call-1', name: 'inspect_model', arguments: {} }],
      toolResults: [{ toolCallId: 'call-1', ok: true, result: { nodes: 0 } }],
    },
  ]),
  null,
);
assert.match(
  validateAssistantMessages([
    {
      role: 'assistant',
      content: 'bad',
      toolCalls: [{ id: 'call-1', name: 'inspect_model', arguments: {} }],
      toolResults: [{ toolCallId: 'missing', ok: false, result: {} }],
    },
  ]),
  /unmatched tool result/,
);

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
  'declined=true',
]) {
  assert.ok(systemPrompt.includes(required), `system prompt must include ${required}`);
}
assert.ok(systemPrompt.includes('刚才那个队列'));
assert.ok(systemPrompt.includes('检查模型'));
const generalPrompt = buildSystemPrompt({ capabilities: [] });
assert.match(generalPrompt, /general-purpose AI agent/);
assert.doesNotMatch(generalPrompt, /inspect_model/);
assert.match(
  buildSystemPrompt({ capabilities: ['logicpilot-modeling'], skills: ['logicpilot-modeling-basics'] }),
  /Skill: logicpilot-modeling-basics/,
);
const readonlyPrompt = buildSystemPrompt({ capabilities: ['logicpilot-modeling-readonly'] });
assert.match(readonlyPrompt, /read-only/);
assert.match(readonlyPrompt, /inspect_model/);
assert.doesNotMatch(readonlyPrompt, /apply_model_patch/);
const mcpTool = {
  name: 'mcp.fixture.echo',
  description: 'Echo from MCP',
  parameters: { text: { type: 'string', required: true } },
};
assert.doesNotThrow(() =>
  validateAssistantResponse(
    {
      message: 'calling MCP',
      plan: [],
      toolCalls: [{ id: 'mcp-1', name: mcpTool.name, arguments: { text: 'hello' } }],
      done: false,
    },
    new Set([mcpTool.name]),
    [...ASSISTANT_TOOLS, mcpTool],
  ),
);
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

// Local gateways sometimes emit a readable transcript instead of strict JSON
// after a tool result. It must still become a structured, validated step.
const transcript = parseAssistantResponseContent(
  'I found a compile issue.\n\nProposed tool calls:\n' +
    'tool_call_id: call-2\nname: inspect_diagnostics\narguments: {}\n\n[tool results]',
);
assert.equal(transcript.done, false);
assert.deepEqual(transcript.toolCalls, [
  { id: 'call-2', name: 'inspect_diagnostics', arguments: {} },
]);
const plainText = parseAssistantResponseContent('The model is ready.');
assert.deepEqual(plainText, { message: 'The model is ready.', plan: [], toolCalls: [], done: true });
assert.equal(
  visibleAssistantMessage(
    '{"message":"开始构建呼叫中心模型。","plan":[],"toolCalls":[{"id":"c1"}],"done":false}',
  ),
  '开始构建呼叫中心模型。',
);

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
      toolCalls: [{ id: 'c', name: 'run_parameter_study', arguments: { arrivals: 'many' } }],
    },
    /must be a finite number/,
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
await runAssistant({
  messages: [{ role: 'user', content: '你好' }],
  context: {},
  capabilities: [],
});
assert.equal(requestBody.tools, undefined);
assert.match(requestBody.messages[0].content, /general-purpose AI agent/);
await runAssistant({
  messages: [
    { role: 'user', content: 'change it' },
    {
      role: 'assistant',
      content: 'proposed',
      toolCalls: [{ id: 'patch-1', name: 'apply_model_patch', arguments: {} }],
      toolResults: [
        {
          toolCallId: 'patch-1',
          ok: false,
          result: {},
          error: 'user declined the proposed model change',
        },
      ],
    },
  ],
  context: {},
});
assert.ok(requestBody.messages[1].content.includes('error: user declined'));
process.env.DEEPSEEK_THINKING = 'sometimes';
await assert.rejects(
  () => runAssistant({ messages: [{ role: 'user', content: 'test' }], context: {} }),
  /must be enabled or disabled/,
);
let schemaAttempts = 0;
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          content:
            schemaAttempts++ === 0
              ? '{"message":"retry me"}'
              : '{"message":"recovered","plan":[],"toolCalls":[],"done":true}',
        },
      },
    ],
  }),
});
delete process.env.DEEPSEEK_THINKING;
const recovered = await runAssistant({
  messages: [{ role: 'user', content: 'schema retry' }],
  context: {},
});
assert.equal(recovered.message, 'recovered');
assert.equal(schemaAttempts, 2);
configureAssistantProvider({
  providerId: 'ollama',
  protocol: 'openai-chat',
  baseUrl: 'http://ollama/v1',
  model: 'qwen3',
});
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          content: '',
          tool_calls: [{ id: 'native-call', function: { name: 'inspect_model', arguments: '{}' } }],
        },
      },
    ],
  }),
});
const nativeResponse = await runAssistant({
  messages: [{ role: 'user', content: 'inspect' }],
  context: {},
});
assert.equal(nativeResponse.done, false);
assert.deepEqual(nativeResponse.toolCalls, [
  { id: 'native-call', name: 'inspect_model', arguments: {} },
]);
clearAssistantProviderSession();
globalThis.fetch = previousFetch;
for (const [name, value] of Object.entries(previousEnvironment)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log('AI-ASSISTANT TEST: PASS');
