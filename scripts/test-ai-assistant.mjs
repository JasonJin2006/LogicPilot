// Server-side tests for the assistant step provider (scripts/ai-assistant.mjs).
// These cover the runtime schema validation and the tool registry contract
// without needing an LLM key; the live LLM path is exercised by the endpoint
// smoke test when OPENAI_API_KEY is present.
import assert from 'node:assert/strict';

import {
  ASSISTANT_TOOLS,
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
assert.deepEqual(
  ASSISTANT_TOOLS.map((tool) => tool.name).sort(),
  [...EXPECTED_TOOLS].sort(),
);
for (const tool of ASSISTANT_TOOLS) {
  assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
  assert.ok(tool.parameters && typeof tool.parameters === 'object');
}

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
  [{ message: 'x', done: false, toolCalls: [{ id: 'c', name: 'not_a_tool', arguments: {} }] }, /not a known tool/],
  [{ message: 'x', done: false, toolCalls: [{ id: 'c', name: 7, arguments: {} }] }, /name must be a string/],
  [{ message: 'x', done: false, plan: [{ id: 1 }] }, /plan\[0\]/],
  [{ message: 'x', done: true, toolCalls: [{ id: 'c', name: 'inspect_model', arguments: {} }] }, /done but still proposes tool calls/],
  ['not json', /object/],
  [{ message: 'x', done: false, toolCalls: [
    { id: 'c', name: 'inspect_model', arguments: { unexpected: true } },
  ] }, /not allowed/],
  [{ message: 'x', done: false, toolCalls: [
    { id: 'c', name: 'apply_model_patch', arguments: { summary: 'x' } },
  ] }, /patch is required/],
  [{ message: 'x', done: false, toolCalls: [
    { id: 'c', name: 'apply_model_patch', arguments: {
      summary: '', patch: { version: 1, operations: [] },
    } },
  ] }, /summary must not be empty/],
  [{ message: 'x', done: false, toolCalls: [
    { id: 'same', name: 'inspect_model', arguments: {} },
    { id: 'same', name: 'inspect_selection', arguments: {} },
  ] }, /duplicated/],
];
for (const [input, pattern] of cases) {
  assert.throws(() => validateAssistantResponse(input), pattern);
}

console.log('AI-ASSISTANT TEST: PASS');
