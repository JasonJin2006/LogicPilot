import assert from 'node:assert/strict';

import {
  buildCodexExecArgs,
  CODEX_ASSISTANT_OUTPUT_SCHEMA,
  normalizeCodexAssistantOutput,
  parseCodexAssistantOutput,
  resolveCodexLaunch,
} from './codex-assistant-provider.mjs';

const args = buildCodexExecArgs({
  directory: 'C:\\Temp\\logicpilot',
  schemaPath: 'C:\\Temp\\logicpilot\\schema.json',
  outputPath: 'C:\\Temp\\logicpilot\\output.json',
  model: 'test-model',
});
for (const required of [
  '--ephemeral',
  '--skip-git-repo-check',
  '--sandbox',
  'read-only',
  '--ignore-user-config',
  '--ignore-rules',
  '--output-schema',
  '--output-last-message',
  '--model',
  'test-model',
  '-',
]) {
  assert.ok(args.includes(required), `Codex args must contain ${required}`);
}
assert.equal(CODEX_ASSISTANT_OUTPUT_SCHEMA.additionalProperties, false);
assert.deepEqual(parseCodexAssistantOutput('{"message":"ok","done":true}'), {
  message: 'ok',
  done: true,
});
assert.deepEqual(parseCodexAssistantOutput('```json\n{"message":"ok"}\n```'), {
  message: 'ok',
});
assert.throws(() => parseCodexAssistantOutput('not json'), /malformed JSON/);
assert.throws(() => parseCodexAssistantOutput('   '), /empty assistant response/);
assert.deepEqual(
  normalizeCodexAssistantOutput({
    message: 'build',
    toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: '{}' }],
  }),
  {
    message: 'build',
    toolCalls: [{ id: 'c1', name: 'inspect_model', arguments: {} }],
  },
);
assert.throws(
  () =>
    normalizeCodexAssistantOutput({
      toolCalls: [{ id: 'broken', name: 'inspect_model', arguments: '{' }],
    }),
  /malformed arguments/,
);
assert.deepEqual(await resolveCodexLaunch('C:\\tools\\codex.js'), {
  executable: process.execPath,
  prefixArgs: ['C:\\tools\\codex.js'],
});

console.log('CODEX ASSISTANT PROVIDER TEST: PASS');
