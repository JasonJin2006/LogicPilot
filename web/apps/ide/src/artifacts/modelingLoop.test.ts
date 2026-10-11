import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyModelPatch, createDocument, generateDsl } from '@logicpilot/editor';
import type { ModelPatch } from '@logicpilot/editor';
import { ExecutionTargetRegistry } from '@logicpilot/plugin-host';
import { handleArtifactGraph } from '../../scripts/plugin-catalog-bridge.mjs';
import { createExecutionHandler } from '../../scripts/execution-endpoint.mjs';
import {
  beginModelPatchTransaction,
  commitModelPatchTransaction,
  persistModelSnapshot,
} from './artifactGraphClient';

/**
 * End-to-end modeling loop against the REAL client, REAL server handlers and
 * a REAL on-disk artifact store: editor Save persists a model-save revision
 * (document + dsl), an AI model patch commits a patch-only revision, and a
 * pinned execution replays the patch chain server-side instead of trusting a
 * caller-supplied DSL string.
 */

const storeRoot = mkdtempSync(join(tmpdir(), 'logicpilot-modeling-loop-'));
const previousRoot = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
const registry = new ExecutionTargetRegistry();
const seenDsls: string[] = [];
const executionHandler = createExecutionHandler({ getRegistry: () => registry });
const realFetch = globalThis.fetch;
let server: Server;
let origin = '';

registry.register({
  target: {
    schema: 'logicpilot.execution-target/v1',
    contractVersion: 1,
    id: 'test.modeling.runtime',
    artifactRef: { artifactId: 'workspace.model' },
    runtime: { kind: 'interpreter' },
  },
  execute: async (request) => {
    seenDsls.push((request.inputs as { readonly dsl?: string }).dsl ?? '');
    return {
      run: {
        schema: 'logicpilot.execution-run/v1',
        contractVersion: 1,
        runId: `run-${request.requestId}`,
        requestId: request.requestId,
        targetId: request.targetId,
        artifactRef: request.artifactRef ?? { artifactId: 'workspace.model' },
        status: 'completed',
      },
    };
  },
});

beforeAll(async () => {
  process.env.LOGICPILOT_ARTIFACT_STORE_ROOT = storeRoot;
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sessionToken: 'modeling-loop-session', wsUrl: '' }));
      return;
    }
    if (url === '/api/artifact-graph') {
      void handleArtifactGraph(req, res);
      return;
    }
    if (url === '/api/execution') {
      void executionHandler(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The client's browser branch resolves same-origin relative URLs; run it in
  // Node by providing window and prefixing relative fetch URLs with the test
  // server origin.
  (globalThis as { window?: unknown }).window = {};
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input;
    return realFetch(url, init);
  }) as typeof fetch;
});

afterAll(async () => {
  delete (globalThis as { window?: unknown }).window;
  globalThis.fetch = realFetch;
  if (previousRoot === undefined) delete process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  else process.env.LOGICPILOT_ARTIFACT_STORE_ROOT = previousRoot;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(storeRoot, { recursive: true, force: true });
});

describe('modeling loop end to end', () => {
  it('persists a save, commits an AI patch and replays it into a pinned execution', async () => {
    // 1. Editor Save: durable model-save revision carrying document + dsl.
    const document = createDocument('LoopModel');
    const saveRevision = await persistModelSnapshot(document);
    expect(saveRevision).toMatch(/^rev-/);

    // 2. AI proposes a patch; the editor applies it locally and compiles.
    const patch: ModelPatch = {
      version: 1,
      operations: [
        { op: 'add_block', kind: 'process', name: 'Arrivals' },
        { op: 'add_block', kind: 'process', name: 'Done' },
        { op: 'connect', from: 'Arrivals', to: 'Done' },
      ],
    };
    const applied = applyModelPatch(document, patch);
    expect(applied.ok).toBe(true);
    const expectedDsl = generateDsl(applied.document);
    expect(expectedDsl).toContain('Arrivals');
    expect(generateDsl(document)).not.toContain('Arrivals');

    // 3. The patch commits as a patch-only revision on top of the save.
    const pending = await beginModelPatchTransaction(patch);
    expect(pending.enabled).toBe(true);
    const patchRevision = await commitModelPatchTransaction(pending);
    expect(patchRevision).toMatch(/^rev-/);
    expect(patchRevision).not.toBe(saveRevision);

    // 4. Pinning the patch-only revision executes the replayed DSL.
    const response = await fetch('/api/execution', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        requestId: 'modeling-loop-1',
        targetId: 'test.modeling.runtime',
        artifactRef: { artifactId: 'workspace.model', revisionId: patchRevision },
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { run: { status: string } };
    expect(payload.run.status).toBe('completed');
    // The executor saw the server-replayed DSL, not the save-time snapshot.
    expect(seenDsls).toEqual([expectedDsl]);
  });
});
