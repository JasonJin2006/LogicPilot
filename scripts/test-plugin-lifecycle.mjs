// Plugin lifecycle HTTP gate: POST /api/plugins { action: 'uninstall' } must
// durably remove the lockfile entry AND hot-swap the Node runtime generation
// so the plugin's execution target is revoked immediately. Re-approval
// (lockfile entry restored) brings the target back through the same path.
//
// Usage: node scripts/test-plugin-lifecycle.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const bundle = await import('../web/packages/plugin-catalog/dist/index.bundle.js');
const bridge = await import('../web/apps/ide/scripts/plugin-catalog-bridge.mjs');
const { computePackageDigest } = bundle;

const PLUGIN_ID = 'logicpilot.lifecycle-demo';
const TARGET_ID = `${PLUGIN_ID}.target`;

const manifest = {
  schema: 'logicpilot.plugin-manifest/v2',
  contractVersion: 1,
  id: PLUGIN_ID,
  version: '1.0.0',
  apiVersion: 1,
  provides: [],
  requires: [],
  entrypoints: { node: './activate.mjs' },
  permissions: [],
  trust: { minLevel: 't0' },
  executionTargets: [
    {
      schema: 'logicpilot.execution-target/v1',
      contractVersion: 1,
      id: TARGET_ID,
      artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
      runtime: { kind: 'interpreter', pluginId: PLUGIN_ID },
    },
  ],
};

function writePlugin(root) {
  const pkg = join(root, 'lifecycle-demo');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, 'activate.mjs'),
    'export function activate(ctx) { ctx.provide("ok", true); }\n' +
      'export function execute(request) { return { run: { schema: "logicpilot.execution-run/v1", contractVersion: 1, runId: "run-lc", requestId: request.requestId, targetId: request.targetId, artifactRef: { artifactId: "model.main", revisionId: "rev-1" }, status: "completed" } }; }',
  );
  writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
  writeFileSync(
    join(pkg, 'contributions.json'),
    JSON.stringify({
      schema: 'logicpilot.plugin-contributions/v1',
      contractVersion: 1,
      pluginId: PLUGIN_ID,
      version: manifest.version,
      knowledge: [],
      skills: [],
      instructions: [],
      diagnostics: [],
      views: [],
      notations: [],
      createActions: [],
      palettes: [],
      tools: [],
    }),
  );
  return { pkg, sha256: computePackageDigest(pkg, manifest) };
}

function lockfileWith(entry) {
  return {
    schema: 'logicpilot.plugin-lock/v1',
    contractVersion: 1,
    ...(entry === undefined ? { plugins: [] } : { plugins: [entry] }),
  };
}

const lockEntry = (sha256) => ({
  id: PLUGIN_ID,
  version: manifest.version,
  apiVersion: manifest.apiVersion,
  sha256,
  trust: 't4',
  permissions: [],
});

async function invoke(body) {
  const bytes = Buffer.from(JSON.stringify(body));
  const req = Readable.from(Array.from(bytes, (byte) => Buffer.from([byte])));
  req.method = 'POST';
  let status;
  let output;
  await bridge.handlePlugins(req, {
    writeHead(value) {
      status = value;
    },
    end(value) {
      output = JSON.parse(value);
    },
  });
  return { status, output };
}

const directory = mkdtempSync(join(tmpdir(), 'lp-plugin-lifecycle-'));
const storeRoot = join(directory, 'store');
const pluginRoot = join(directory, 'roots');
mkdirSync(storeRoot, { recursive: true });
mkdirSync(pluginRoot, { recursive: true });
const { sha256 } = writePlugin(pluginRoot);
const store = new bundle.FileSystemPackageStore({ rootDir: storeRoot });
store.writeLockfile(lockfileWith(lockEntry(sha256)));

const previousEnv = { ...process.env };
process.env.LOGICPILOT_ENABLE_NODE_PLUGINS = '1';
process.env.LOGICPILOT_NODE_PLUGIN_TRUST = 't4';
process.env.LOGICPILOT_PLUGIN_STORE_ROOT = storeRoot;
process.env.LOGICPILOT_PLUGIN_ROOTS = JSON.stringify({
  system: [],
  user: [],
  workspace: [pluginRoot],
});

try {
  const runtime = await bridge.startNodePluginRuntime();
  assert.equal(runtime.snapshot()?.host?.isActive(PLUGIN_ID), true);
  assert.ok(
    runtime
      .executionTargetRegistry()
      .list()
      .some((target) => target.id === TARGET_ID),
    'demo execution target must be registered before uninstall',
  );

  // 1. Uninstalling an unknown plugin is a clean 404.
  const missing = await invoke({ action: 'uninstall', pluginId: 'logicpilot.not-installed' });
  assert.equal(missing.status, 404);
  assert.equal(missing.output.ok, false);

  // 2. Uninstall revokes the runtime generation immediately.
  const result = await invoke({ action: 'uninstall', pluginId: PLUGIN_ID });
  assert.equal(result.status, 200, JSON.stringify(result.output));
  assert.equal(result.output.ok, true);
  assert.equal(result.output.uninstalled, PLUGIN_ID);
  assert.deepEqual(result.output.installed, []);
  assert.equal(runtime.snapshot()?.host?.isActive(PLUGIN_ID), false);
  assert.deepEqual(
    runtime
      .executionTargetRegistry()
      .list()
      .filter((target) => target.id === TARGET_ID),
    [],
  );
  assert.deepEqual(store.readLockfile()?.plugins ?? [], []);

  // 3. A second uninstall is a 404, not a silent success.
  const again = await invoke({ action: 'uninstall', pluginId: PLUGIN_ID });
  assert.equal(again.status, 404);

  // 4. Malformed requests fail closed.
  assert.equal((await invoke({ action: 'destroy' })).status, 400);
  assert.equal((await invoke({ action: 'uninstall' })).status, 400);
  const badBody = Readable.from([Buffer.from('not-json')]);
  badBody.method = 'POST';
  let badStatus;
  await bridge.handlePlugins(badBody, {
    writeHead(value) {
      badStatus = value;
    },
    end() {},
  });
  assert.equal(badStatus, 400);

  // 5. Re-approval (any installer restoring the lockfile entry) brings the
  //    target back through the same refresh path.
  store.writeLockfile(lockfileWith(lockEntry(sha256)));
  await runtime.refresh();
  assert.equal(runtime.snapshot()?.host?.isActive(PLUGIN_ID), true);
  assert.ok(
    runtime
      .executionTargetRegistry()
      .list()
      .some((target) => target.id === TARGET_ID),
    'demo execution target must return after re-approval',
  );

  await bridge.stopNodePluginRuntime();
  console.log('PLUGIN-LIFECYCLE TEST: PASS');
} finally {
  process.env.LOGICPILOT_ENABLE_NODE_PLUGINS = previousEnv.LOGICPILOT_ENABLE_NODE_PLUGINS;
  process.env.LOGICPILOT_NODE_PLUGIN_TRUST = previousEnv.LOGICPILOT_NODE_PLUGIN_TRUST;
  process.env.LOGICPILOT_PLUGIN_STORE_ROOT = previousEnv.LOGICPILOT_PLUGIN_STORE_ROOT;
  process.env.LOGICPILOT_PLUGIN_ROOTS = previousEnv.LOGICPILOT_PLUGIN_ROOTS;
  rmSync(directory, { recursive: true, force: true });
}
