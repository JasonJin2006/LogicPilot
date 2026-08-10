import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildCodexExecArgs,
  buildCodexAppServerArgs,
  CODEX_ASSISTANT_OUTPUT_SCHEMA,
  CodexAppServerClient,
  normalizeCodexAssistantOutput,
  parseCodexAssistantOutput,
  resolveCodexLaunch,
} from './codex-assistant-provider.mjs';

assert.deepEqual(buildCodexAppServerArgs(), ['app-server', '--listen', 'stdio://']);

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

const requests = [];
let spawnCount = 0;
const spawnFakeAppServer = () => {
  spawnCount += 1;
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.unref = () => {};
  child.kill = () => child.emit('close', 0);
  let buffer = '';
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin.on('data', (chunk) => {
    buffer += String(chunk);
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line);
      requests.push(message);
      if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'test' } });
      if (message.method === 'thread/start') {
        send({ id: message.id, result: { thread: { id: 'thread-test' } } });
      }
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-test', status: 'inProgress' } } });
        send({
          method: 'item/completed',
          params: {
            threadId: 'thread-test',
            turnId: 'turn-test',
            item: {
              type: 'agentMessage',
              phase: 'final_answer',
              text: '{"message":"ok","plan":[],"toolCalls":[],"done":true}',
            },
          },
        });
        send({
          method: 'turn/completed',
          params: {
            threadId: 'thread-test',
            turn: { id: 'turn-test', status: 'completed' },
          },
        });
      }
      if (message.method === 'thread/delete') send({ id: message.id, result: {} });
      newline = buffer.indexOf('\n');
    }
  });
  return child;
};

const appServer = new CodexAppServerClient({
  launch: { executable: 'fake-codex', prefixArgs: [] },
  spawnImpl: spawnFakeAppServer,
});
const appServerContent = await appServer.runTurn({
  prompt: 'test',
  outputSchema: CODEX_ASSISTANT_OUTPUT_SCHEMA,
  timeoutMs: 5_000,
});
assert.equal(appServerContent, '{"message":"ok","plan":[],"toolCalls":[],"done":true}');
await appServer.runTurn({
  prompt: 'test again',
  outputSchema: CODEX_ASSISTANT_OUTPUT_SCHEMA,
  timeoutMs: 5_000,
});
assert.equal(spawnCount, 1, 'successive turns must reuse one app-server process');
assert.deepEqual(
  requests.filter((message) => message.method).map((message) => message.method),
  [
    'initialize',
    'initialized',
    'thread/start',
    'turn/start',
    'thread/delete',
    'thread/start',
    'turn/start',
    'thread/delete',
  ],
);
assert.equal(
  requests.find((message) => message.method === 'thread/start').params.sandbox,
  'read-only',
);
assert.equal(
  requests.find((message) => message.method === 'turn/start').params.sandboxPolicy.type,
  'readOnly',
);
appServer.close();

console.log('CODEX ASSISTANT PROVIDER TEST: PASS');
