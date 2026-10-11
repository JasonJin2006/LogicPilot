import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { REQUEST_CANCEL_SIGNAL } from '../app/request-policy.mjs';
import {
  ExecutionService,
  ExecutionTargetRegistry,
  FileSystemArtifactStore,
} from '../web/packages/plugin-catalog/dist/index.bundle.js';
import {
  createExecutionHandler,
  MAX_EXECUTION_WALL_MS,
} from '../web/apps/ide/scripts/execution-endpoint.mjs';
import {
  applyModelPatch,
  createDocument,
  generateDsl,
} from '../web/packages/editor/dist/editor.bundle.js';
import {
  materializeExecutionSource,
  persistExecutionResult,
} from '../web/apps/ide/scripts/execution-artifacts.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lp-execution-boundary-'));
const previousRoot = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
process.env.LOGICPILOT_ARTIFACT_STORE_ROOT = directory;
try {
  const store = new FileSystemArtifactStore({ rootDir: directory });
  store.createArtifact({ id: 'model.main', kind: 'semantic-model', createdBy: 'test' });
  store.propose({
    id: 'save',
    proposedBy: 'test',
    artifactRefs: [{ artifactId: 'model.main' }],
    operations: [{ opId: 'save', opType: 'model-save', payload: { dsl: 'model 模型 {}' } }],
  });
  store.validate('save');
  store.approve('save', 'test');
  store.commit({
    transactionId: 'save',
    revisionId: 'rev-1',
    artifactId: 'model.main',
    createdBy: 'test',
    digest: 'a'.repeat(64),
  });
  assert.throws(() => materializeExecutionSource({ artifactId: 'model.main' }), /explicit/);
  let active = new ExecutionTargetRegistry();
  let calls = 0;
  const seenBudgets = [];
  active.register({
    target: {
      schema: 'logicpilot.execution-target/v1',
      contractVersion: 1,
      id: 'test.runtime',
      artifactRef: { artifactId: 'model.main' },
      runtime: { kind: 'interpreter' },
    },
    execute: async (request) => {
      calls++;
      seenBudgets.push(request.budget);
      assert.equal(request.inputs.dsl, 'model 模型 {}');
      return {
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'run-1',
          requestId: request.requestId,
          targetId: request.targetId,
          artifactRef: request.artifactRef,
          seed: request.seed,
          status: 'completed',
        },
        evidence: {
          schema: 'logicpilot.execution-evidence/v1',
          contractVersion: 1,
          runId: 'run-1',
          digest: 'b'.repeat(64),
        },
      };
    },
  });
  const handler = createExecutionHandler({ getRegistry: () => active });
  const request = {
    action: 'execute',
    requestId: 'request-1',
    targetId: 'test.runtime',
    seed: 71,
    artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
  };
  const invokeWith =
    (useHandler) =>
    async (body, method = 'POST', url = '/api/execution') => {
      const bytes = Buffer.from(body);
      const req = Readable.from(Array.from(bytes, (byte) => Buffer.from([byte])));
      req.method = method;
      req.url = url;
      let status;
      let output;
      await useHandler(req, {
        writeHead(value) {
          status = value;
        },
        end(value) {
          output = JSON.parse(value);
        },
      });
      return { status, output };
    };
  const invoke = invokeWith(handler);
  assert.equal((await invoke('{')).status, 400);
  assert.equal((await invoke(JSON.stringify({ ...request, seed: '71' }))).status, 400);
  assert.equal(
    (await invoke(JSON.stringify({ ...request, inputs: { dsl: 'different' } }))).status,
    409,
  );
  assert.equal(calls, 0);
  const response = await invoke(JSON.stringify({ ...request, inputs: { dsl: 'model 模型 {}' } }));
  assert.equal(response.status, 200);
  assert.equal(response.output.run.seed, 71);
  // New session entrypoint: the same provider registry now assigns a server
  // run id and returns immediately, while the legacy execute action remains
  // covered above.
  const sessionRegistry = new ExecutionTargetRegistry();
  sessionRegistry.register({
    target: {
      schema: 'logicpilot.execution-target/v1',
      contractVersion: 1,
      id: 'session.runtime',
      artifactRef: { artifactId: 'model.main' },
      runtime: { kind: 'interpreter' },
      capabilities: { cancel: false, telemetry: false, snapshot: true },
    },
    execute: async (sessionRequest) => ({
      run: {
        schema: 'logicpilot.execution-run/v1',
        contractVersion: 1,
        runId: sessionRequest.runId,
        requestId: sessionRequest.requestId,
        targetId: sessionRequest.targetId,
        artifactRef: sessionRequest.artifactRef,
        seed: sessionRequest.seed,
        status: 'completed',
      },
    }),
  });
  const sessionService = new ExecutionService({ registry: sessionRegistry });
  const sessionInvoke = invokeWith(
    createExecutionHandler({
      getRegistry: () => sessionRegistry,
      getService: () => sessionService,
      persist: async () => ({}),
    }),
  );
  const started = await sessionInvoke(
    JSON.stringify({
      requestId: 'session-request-1',
      targetId: 'session.runtime',
      artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
      seed: 71,
      inputs: { dsl: 'model 模型 {}' },
    }),
    'POST',
    '/api/execution/runs',
  );
  assert.equal(started.status, 202);
  assert.equal(started.output.session.requestId, 'session-request-1');
  const sessionResult = await sessionService.wait(started.output.session.runId);
  assert.equal(sessionResult.run.runId, started.output.session.runId);
  const queried = await sessionInvoke(
    '',
    'GET',
    `/api/execution/runs/${encodeURIComponent(started.output.session.runId)}`,
  );
  assert.equal(queried.status, 200);
  assert.equal(queried.output.session.runId, started.output.session.runId);
  assert.deepEqual(
    queried.output.events.map((event) => event.kind),
    ['state', 'terminal'],
  );
  const listed = await sessionInvoke('', 'GET', '/api/execution/runs');
  assert.equal(listed.status, 200);
  assert.equal(listed.output.schema, 'logicpilot.execution-runs/v1');
  assert.ok(listed.output.sessions.some((item) => item.runId === started.output.session.runId));
  const unsupportedCommand = await sessionInvoke(
    JSON.stringify({
      schema: 'logicpilot.execution-command/v1',
      contractVersion: 1,
      commandId: 'unsupported-command',
      runId: started.output.session.runId,
      action: 'pause',
      expectedStateVersion: queried.output.session.stateVersion,
    }),
    'POST',
    `/api/execution/runs/${encodeURIComponent(started.output.session.runId)}/commands`,
  );
  assert.equal(unsupportedCommand.status, 200);
  assert.equal(unsupportedCommand.output.accepted, false);
  assert.equal(unsupportedCommand.output.errorCode, 'capability-unsupported');
  const runRevision = store.read().revisions.find((item) => item.artifactId.endsWith(':run'));
  assert.deepEqual(
    runRevision.operations[0].payload.run.evidenceRef,
    response.output.run.evidenceRef,
  );
  assert.equal(runRevision.operations[0].payload.request.seed, 71);
  // Identical retries are idempotent; reuse with a different result fails.
  assert.equal(
    (await invoke(JSON.stringify({ ...request, inputs: { dsl: 'model 模型 {}' } }))).status,
    200,
  );
  assert.equal(store.read().revisions.length, 3);
  await assert.rejects(
    persistExecutionResult({ requestId: 'request-1', targetId: 'test.runtime' }, response.output),
    /reused/,
  );
  // Server-side budget policy: absent wall budget gets the server default;
  // budgets above the hard ceiling are rejected before the executor runs.
  assert.ok(
    seenBudgets.length >= 2 &&
      seenBudgets.every((budget) => budget.maxWallMs === MAX_EXECUTION_WALL_MS),
  );
  const callsBeforeOversize = calls;
  const oversized = await invoke(
    JSON.stringify({ ...request, budget: { maxWallMs: MAX_EXECUTION_WALL_MS + 1 } }),
  );
  assert.equal(oversized.status, 400);
  assert.equal(calls, callsBeforeOversize);
  const exactCeiling = await invoke(
    JSON.stringify({ ...request, budget: { maxWallMs: MAX_EXECUTION_WALL_MS } }),
  );
  assert.equal(exactCeiling.status, 200);
  // Client disconnect or a request-policy abort must cancel the in-flight
  // run through the injected cancel callback.
  const cancelledIds = [];
  let releaseGatedRun;
  const gated = new ExecutionTargetRegistry();
  gated.register({
    target: {
      schema: 'logicpilot.execution-target/v1',
      contractVersion: 1,
      id: 'test.runtime',
      artifactRef: { artifactId: 'model.main' },
      runtime: { kind: 'interpreter' },
    },
    execute: async (gateRequest) => {
      assert.equal(gateRequest.inputs.dsl, 'model 模型 {}');
      await new Promise((resolve) => {
        releaseGatedRun = resolve;
      });
      return {
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'run-disconnect',
          requestId: gateRequest.requestId,
          targetId: gateRequest.targetId,
          artifactRef: gateRequest.artifactRef,
          status: 'completed',
        },
      };
    },
  });
  const cancelable = createExecutionHandler({
    getRegistry: () => gated,
    cancelRun: (requestId) => cancelledIds.push(requestId),
  });
  const disconnectedRes = new EventEmitter();
  disconnectedRes.writableEnded = false;
  disconnectedRes.destroyed = false;
  disconnectedRes.writeHead = () => {};
  disconnectedRes.end = () => {
    disconnectedRes.writableEnded = true;
  };
  const disconnectedReq = Readable.from([
    Buffer.from(JSON.stringify({ ...request, requestId: 'request-disconnect' })),
  ]);
  disconnectedReq.method = 'POST';
  const pendingDisconnect = cancelable(disconnectedReq, disconnectedRes);
  await new Promise((resolve) => setTimeout(resolve, 20));
  disconnectedRes.emit('close');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(cancelledIds, ['request-disconnect']);
  releaseGatedRun();
  await pendingDisconnect;

  const policyRes = new EventEmitter();
  policyRes.writableEnded = false;
  policyRes.destroyed = false;
  policyRes.writeHead = () => {};
  policyRes.end = () => {
    policyRes.writableEnded = true;
  };
  const policyReq = Readable.from([
    Buffer.from(JSON.stringify({ ...request, requestId: 'request-policy-cancel' })),
  ]);
  policyReq.method = 'POST';
  const aborted = new AbortController();
  aborted.abort();
  Object.defineProperty(policyReq, REQUEST_CANCEL_SIGNAL, { value: aborted.signal });
  const policyHandler = createExecutionHandler({
    getRegistry: () => active,
    cancelRun: (requestId) => cancelledIds.push(requestId),
  });
  await policyHandler(policyReq, policyRes);
  assert.deepEqual(cancelledIds, ['request-disconnect', 'request-policy-cancel']);
  // Patch-only revision materialization: a pinned revision that only carries
  // model-patch operations must replay the chain over the nearest model-save
  // snapshot and execute the reconstructed DSL.
  {
    const document = createDocument('Patched');
    store.createArtifact({ id: 'model.patched', kind: 'semantic-model', createdBy: 'test' });
    store.propose({
      id: 'save-p',
      proposedBy: 'test',
      artifactRefs: [{ artifactId: 'model.patched' }],
      operations: [
        { opId: 'save-p', opType: 'model-save', payload: { document, dsl: generateDsl(document) } },
      ],
    });
    store.validate('save-p');
    store.approve('save-p', 'test');
    store.commit({
      transactionId: 'save-p',
      revisionId: 'rev-base',
      artifactId: 'model.patched',
      createdBy: 'test',
      digest: 'e'.repeat(64),
    });
    const patches = [
      { version: 1, operations: [{ op: 'add_block', kind: 'process', name: 'S1' }] },
      {
        version: 1,
        operations: [
          { op: 'add_block', kind: 'process', name: 'S2' },
          { op: 'connect', from: 'S1', to: 'S2' },
        ],
      },
      { version: 1, operations: [{ op: 'rename_model', name: 'Renamed' }] },
    ];
    let parent = 'rev-base';
    const revisionIds = [];
    for (const [index, patch] of patches.entries()) {
      const transactionId = `patch-${index}`;
      store.propose({
        id: transactionId,
        proposedBy: 'test',
        artifactRefs: [{ artifactId: 'model.patched', revisionId: parent }],
        operations: [{ opId: transactionId, opType: 'model-patch', payload: patch }],
      });
      store.validate(transactionId);
      store.approve(transactionId, 'test');
      const revisionId = `rev-patch-${index}`;
      store.commit({
        transactionId,
        revisionId,
        artifactId: 'model.patched',
        createdBy: 'test',
        digest: 'f'.repeat(64),
      });
      revisionIds.push(revisionId);
      parent = revisionId;
    }
    let expected = document;
    for (const patch of patches) {
      const applied = applyModelPatch(expected, patch);
      assert.equal(applied.ok, true, JSON.stringify(applied.diagnostics));
      expected = applied.document;
    }
    const expectedDsl = generateDsl(expected);
    assert.match(expectedDsl, /Renamed/);
    assert.match(expectedDsl, /S1/);
    const materialized = materializeExecutionSource({
      artifactId: 'model.patched',
      revisionId: revisionIds[revisionIds.length - 1],
    });
    assert.equal(materialized, expectedDsl);
    // The endpoint executes the patch-only pin against the materialized DSL.
    const seenDsls = [];
    const patchRegistry = new ExecutionTargetRegistry();
    patchRegistry.register({
      target: {
        schema: 'logicpilot.execution-target/v1',
        contractVersion: 1,
        id: 'test.runtime',
        artifactRef: { artifactId: 'model.patched' },
        runtime: { kind: 'interpreter' },
      },
      execute: async (runRequest) => {
        seenDsls.push(runRequest.inputs.dsl);
        return {
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: 'run-patch',
            requestId: runRequest.requestId,
            targetId: runRequest.targetId,
            artifactRef: runRequest.artifactRef,
            status: 'completed',
          },
        };
      },
    });
    const patchInvoke = invokeWith(createExecutionHandler({ getRegistry: () => patchRegistry }));
    const patchedRun = await patchInvoke(
      JSON.stringify({
        action: 'execute',
        requestId: 'request-patch',
        targetId: 'test.runtime',
        artifactRef: {
          artifactId: 'model.patched',
          revisionId: revisionIds[revisionIds.length - 1],
        },
      }),
    );
    assert.equal(patchedRun.status, 200, JSON.stringify(patchedRun.output));
    assert.deepEqual(seenDsls, [expectedDsl]);
    // A patch that cannot be applied rejects the pin with 409 before any
    // executor side effect runs.
    store.propose({
      id: 'patch-bad',
      proposedBy: 'test',
      artifactRefs: [{ artifactId: 'model.patched', revisionId: parent }],
      operations: [
        {
          opId: 'patch-bad',
          opType: 'model-patch',
          payload: { version: 1, operations: [{ op: 'remove_block', target: 'missing' }] },
        },
      ],
    });
    store.validate('patch-bad');
    store.approve('patch-bad', 'test');
    store.commit({
      transactionId: 'patch-bad',
      revisionId: 'rev-patch-bad',
      artifactId: 'model.patched',
      createdBy: 'test',
      digest: 'a'.repeat(64),
    });
    const badRun = await patchInvoke(
      JSON.stringify({
        action: 'execute',
        requestId: 'request-patch-bad',
        targetId: 'test.runtime',
        artifactRef: { artifactId: 'model.patched', revisionId: 'rev-patch-bad' },
      }),
    );
    assert.equal(badRun.status, 409);
    assert.match(badRun.output.error, /patch chain failed: MP2001/);
    assert.deepEqual(seenDsls, [expectedDsl]);
  }
  active = null;
  assert.deepEqual((await invoke('', 'GET')).output.targets, []);
  assert.equal((await invoke(JSON.stringify(request))).status, 404);
  assert.equal((await invoke('', 'DELETE')).status, 405);
  // Size checks should not retain the rejected body; use chunks, not byte-wise fixture here.
  const req = Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1)]);
  req.method = 'POST';
  let status;
  await handler(req, {
    writeHead(value) {
      status = value;
    },
    end() {},
  });
  assert.equal(status, 413);
  console.log('EXECUTION-BOUNDARY TEST: PASS');
} finally {
  if (previousRoot === undefined) delete process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  else process.env.LOGICPILOT_ARTIFACT_STORE_ROOT = previousRoot;
  rmSync(directory, { recursive: true, force: true });
}
