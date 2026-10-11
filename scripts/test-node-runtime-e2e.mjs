// Real Node plugin vertical slice: generated runtime package -> catalog scan ->
// lockfile approval -> isolated Worker -> kernel-backed execution target.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRuntimePlugins } from './build-runtime-plugins.mjs';
import {
  getNodeExecutionService,
  getNodeExecutionTargetRegistry,
  startNodePluginRuntime,
  stopNodePluginRuntime,
} from '../web/apps/ide/scripts/plugin-catalog-bridge.mjs';
import { handleAiRun } from '../web/apps/ide/scripts/ai-endpoint.mjs';

const root = mkdtempSync(join(process.cwd(), 'build', 'node-runtime-e2e-'));
const previous = new Map([
  ['LOGICPILOT_ENABLE_NODE_PLUGINS', process.env.LOGICPILOT_ENABLE_NODE_PLUGINS],
  ['LOGICPILOT_NODE_PLUGIN_TRUST', process.env.LOGICPILOT_NODE_PLUGIN_TRUST],
  ['LOGICPILOT_PLUGIN_STORE_ROOT', process.env.LOGICPILOT_PLUGIN_STORE_ROOT],
  ['LOGICPILOT_PLUGIN_ROOTS', process.env.LOGICPILOT_PLUGIN_ROOTS],
  ['LOGICPILOT_EXECUTION_RUN_STORE_ROOT', process.env.LOGICPILOT_EXECUTION_RUN_STORE_ROOT],
]);
try {
  const packageRoot = join(root, 'plugins');
  const storeRoot = join(root, 'store');
  const runStoreRoot = join(root, 'runs');
  buildRuntimePlugins(packageRoot, storeRoot);
  process.env.LOGICPILOT_ENABLE_NODE_PLUGINS = '1';
  process.env.LOGICPILOT_NODE_PLUGIN_TRUST = 't4';
  process.env.LOGICPILOT_PLUGIN_STORE_ROOT = storeRoot;
  process.env.LOGICPILOT_PLUGIN_ROOTS = JSON.stringify({
    system: [packageRoot],
    user: [],
    workspace: [],
  });
  process.env.LOGICPILOT_EXECUTION_RUN_STORE_ROOT = runStoreRoot;
  await startNodePluginRuntime();
  const registry = getNodeExecutionTargetRegistry();
  assert.ok(registry);
  const result = await registry.execute('logicpilot.process.runtime', {
    schema: 'logicpilot.execution-request/v1',
    contractVersion: 1,
    requestId: 'node-runtime-e2e',
    targetId: 'logicpilot.process.runtime',
    budget: { maxWallMs: 30_000 },
    inputs: {
      paradigm: 'process',
      dsl: readFileSync(new URL('../examples/mm1.lp', import.meta.url), 'utf8'),
    },
  });
  if (result.run.status !== 'completed') console.error(JSON.stringify(result, null, 2));
  assert.equal(result.run.status, 'completed');
  assert.equal(result.evidence?.runtimeKind, 'process');
  assert.equal(result.output?.ok, true);
  assert.ok(result.output?.metrics?.blocks?.length > 0);
  const service = getNodeExecutionService();
  assert.ok(service);
  const session = await service.start({
    schema: 'logicpilot.execution-request/v1',
    contractVersion: 1,
    requestId: 'node-runtime-session-e2e',
    targetId: 'logicpilot.process.runtime',
    budget: { maxWallMs: 30_000 },
    inputs: {
      paradigm: 'process',
      dsl: readFileSync(new URL('../examples/mm1.lp', import.meta.url), 'utf8'),
    },
  });
  const sessionResult = await service.wait(session.runId);
  assert.equal(sessionResult.run.runId, session.runId);
  const persisted = JSON.parse(readFileSync(join(runStoreRoot, 'execution-sessions.json'), 'utf8'));
  assert.equal(
    persisted.sessions.find((item) => item.runId === session.runId)?.status,
    'completed',
  );
  const aiRequest = Readable.from([
    JSON.stringify({
      dsl: readFileSync(new URL('../examples/mm1.lp', import.meta.url), 'utf8'),
      runtimeKind: 'process',
      requestId: 'node-runtime-ai-e2e',
      seed: 43,
      reps: 1,
      arrivals: 100,
      warmup: 0,
    }),
  ]);
  aiRequest.method = 'POST';
  let aiStatus;
  let aiPayload;
  await handleAiRun(aiRequest, {
    writeHead(status) {
      aiStatus = status;
    },
    end(body) {
      aiPayload = JSON.parse(body);
    },
  });
  assert.equal(aiStatus, 200, JSON.stringify(aiPayload));
  assert.equal(aiPayload.ok, true, JSON.stringify(aiPayload));
  assert.equal(aiPayload.execution.run.requestId, 'node-runtime-ai-e2e');
  assert.ok(aiPayload.metrics?.blocks?.length > 0);
  const genericResult = await registry.execute('logicpilot.generic.runtime', {
    schema: 'logicpilot.execution-request/v1',
    contractVersion: 1,
    requestId: 'node-runtime-generic-e2e',
    targetId: 'logicpilot.generic.runtime',
    budget: { maxWallMs: 30_000 },
    inputs: {
      paradigm: 'generic',
      dsl: readFileSync(
        new URL('../examples/cases/multimethod/smart_factory.lp', import.meta.url),
        'utf8',
      ),
      runParams: { seed: 44, seedMode: 'fixed', reps: 1, arrivals: 100, warmup: 0 },
    },
  });
  assert.equal(genericResult.run.status, 'completed', JSON.stringify(genericResult));
  assert.ok(genericResult.output?.methods?.length >= 2, JSON.stringify(genericResult.output));
  assert.ok(genericResult.evidence?.methods?.includes('process'));
  assert.ok(genericResult.evidence?.methods?.includes('agent'));
  assert.equal(genericResult.evidence?.runtimeKind, undefined);
  console.log('NODE-RUNTIME-E2E TEST: PASS');
} finally {
  await stopNodePluginRuntime().catch(() => undefined);
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
}
