// Plugin catalog bridge (Phase 2B-1, ADR-0071 §6): mounts the Node-side
// catalog scanner behind a read-only GET endpoint for both the Vite dev
// middleware and the production app server. The browser only ever receives
// the validated catalog envelope; it never scans the filesystem itself.
//
// LOGICPILOT_PLUGIN_ROOTS (JSON: {"system":[...],"user":[...],"workspace":[...]})
// configures the scanned directories. Unset means no roots -> empty catalog.

import {
  createPluginCatalogHandler,
  createPluginManagementHandler,
  FileSystemArtifactStore,
  FileSystemPackageStore,
  NodePluginRuntime,
  pluginRootsFromEnv,
} from '../../../packages/plugin-catalog/dist/index.bundle.js';

let nodePluginRuntime;
const registryClients = new Set();
let registrySubscription;

/** GET /api/plugin-catalog[?scope=system|user|workspace] */
export function handlePluginCatalog(req, res) {
  return createPluginCatalogHandler({ roots: pluginRootsFromEnv(process.env) })(req, res);
}

/** GET /api/plugins: catalog plus sanitized installed/audit state. */
export function handlePlugins(req, res) {
  const roots = pluginRootsFromEnv(process.env);
  const storeRoot = process.env.LOGICPILOT_PLUGIN_STORE_ROOT;
  const store = storeRoot ? new FileSystemPackageStore({ rootDir: storeRoot }) : undefined;
  return createPluginManagementHandler({
    catalog: { roots },
    ...(store
      ? {
          readLockfile: () => store.readLockfile(),
          readAudit: () => store.readAudit(),
          listInstalledPackages: () => store.listInstalledPackages(),
        }
      : {}),
  })(req, res);
}

/** GET /api/plugin-registry: active generation plus structured contributions. */
export function handlePluginRegistry(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(registryPayload()));
}

function readArtifactBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 1024 * 1024 && !settled) {
        settled = true;
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('artifact graph request is too large'), { status: 413 }));
        return;
      }
      if (!settled) body += chunk;
    });
    req.on('end', () => {
      if (!settled) resolve(body);
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

function artifactStoreFromEnv() {
  const root = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  return root ? new FileSystemArtifactStore({ rootDir: root }) : undefined;
}

function sendArtifactError(res, error) {
  const status =
    error?.status ??
    (error?.code === 'not-found'
      ? 404
      : error?.code === 'conflict'
        ? 409
        : error?.code === 'validation' || error?.code === 'invalid'
          ? 400
          : 500);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  // Store errors are intentionally reduced to stable messages. Never expose
  // paths or raw filesystem exceptions through the browser API.
  res.end(
    JSON.stringify({ ok: false, error: String(error?.message ?? 'artifact graph unavailable') }),
  );
}

/** GET/POST /api/artifact-graph: persistent graph view and the unified
 * propose -> validate -> approve -> commit transaction boundary. The browser
 * receives validated entities only; filesystem errors remain server-side. */
export async function handleArtifactGraph(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  const root = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  if (!root) {
    if (req.method === 'POST') {
      sendArtifactError(
        res,
        Object.assign(new Error('artifact graph is not configured'), { status: 503 }),
      );
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(
      JSON.stringify({
        schema: 'logicpilot.artifact-graph-view/v1',
        contractVersion: 1,
        configured: false,
        artifacts: [],
        revisions: [],
        transactions: [],
      }),
    );
    return;
  }
  try {
    const store = artifactStoreFromEnv();
    if (!store) throw Object.assign(new Error('artifact graph is not configured'), { status: 503 });
    if (req.method === 'POST') {
      const raw = await readArtifactBody(req);
      let input;
      try {
        input = JSON.parse(raw || '{}');
      } catch {
        throw Object.assign(new Error('request body is not valid JSON'), { status: 400 });
      }
      if (typeof input !== 'object' || input === null || typeof input.action !== 'string') {
        throw Object.assign(new Error('artifact graph action is required'), { status: 400 });
      }
      let result;
      switch (input.action) {
        case 'create-artifact':
          result = store.createArtifact(input.input ?? {});
          break;
        case 'propose':
          result = store.propose(input.input ?? {});
          break;
        case 'validate':
          result = store.validate(String(input.transactionId ?? ''));
          break;
        case 'approve':
          result = store.approve(String(input.transactionId ?? ''), String(input.approvedBy ?? ''));
          break;
        case 'rollback':
          result = store.rollbackTransaction(
            String(input.transactionId ?? ''),
            typeof input.resolutionRecord === 'string'
              ? input.resolutionRecord
              : 'artifact-graph.rollback',
          );
          break;
        case 'commit':
          result = store.commit(input.input ?? {});
          break;
        default:
          throw Object.assign(new Error(`unsupported artifact graph action '${input.action}'`), {
            status: 400,
          });
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(
        JSON.stringify({
          schema: 'logicpilot.artifact-graph-operation/v1',
          action: input.action,
          result,
        }),
      );
      return;
    }
    const state = store.read();
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(
      JSON.stringify({
        schema: 'logicpilot.artifact-graph-view/v1',
        contractVersion: 1,
        configured: true,
        ...state,
      }),
    );
  } catch (error) {
    sendArtifactError(res, error);
  }
}

/** GET /api/plugin-registry/stream: SSE snapshots on every committed
 * generation. The stream is read-only and inherits the app-server session and
 * local-origin policy. */
export function handlePluginRegistryStream(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  });
  res.write(`event: registry\ndata: ${JSON.stringify(registryPayload())}\n\n`);
  registryClients.add(res);
  res.on('close', () => registryClients.delete(res));
  ensureRegistrySubscription();
}

function ensureRegistrySubscription() {
  if (registrySubscription || !nodePluginRuntime) return;
  registrySubscription = nodePluginRuntime.subscribe(() => {
    const event = `event: registry\ndata: ${JSON.stringify(registryPayload())}\n\n`;
    for (const client of [...registryClients]) {
      try {
        client.write(event);
      } catch {
        registryClients.delete(client);
      }
    }
  });
}

function registryPayload() {
  const snapshot = nodePluginRuntime?.snapshot();
  const registry = nodePluginRuntime?.contributionRegistry().snapshot();
  return {
    schema: 'logicpilot.plugin-registry/v1',
    contractVersion: 1,
    generation: snapshot?.generation ?? registry?.generation ?? 0,
    plugins: snapshot?.host.ids() ?? [],
    contributions: (registry?.sets ?? []).map(sanitizeContributionSet),
  };
}

function sanitizeContributionSet(set) {
  const copy = structuredClone(set);
  for (const block of copy.knowledge ?? []) {
    for (const source of block.provenance ?? []) source.source = sanitizePath(source.source);
    for (const media of block.media ?? []) media.uri = sanitizePath(media.uri);
  }
  return copy;
}

function sanitizePath(value) {
  return /^[A-Za-z]:[\\/]|^\\\\|^\//.test(value) ? '[local-path]' : value;
}

/** Opt-in Node PluginHost wiring for the desktop app server. It is disabled
 * by default; executable ESM still requires T4 and WASM T2 even when enabled. */
export async function startNodePluginRuntime() {
  if (process.env.LOGICPILOT_ENABLE_NODE_PLUGINS !== '1') return null;
  if (nodePluginRuntime) return nodePluginRuntime;
  const trust = process.env.LOGICPILOT_NODE_PLUGIN_TRUST ?? 't0';
  if (!['t0', 't1', 't2', 't3', 't4', 't5'].includes(trust)) {
    throw new Error(`LOGICPILOT_NODE_PLUGIN_TRUST is invalid: ${trust}`);
  }
  const storeRoot = process.env.LOGICPILOT_PLUGIN_STORE_ROOT;
  if (!storeRoot) {
    throw new Error('LOGICPILOT_PLUGIN_STORE_ROOT is required when Node plugins are enabled');
  }
  const store = new FileSystemPackageStore({ rootDir: storeRoot });
  nodePluginRuntime = new NodePluginRuntime({
    roots: pluginRootsFromEnv(process.env),
    defaultTrustLevel: trust,
    readLockfile: () => store.readLockfile(),
    requireLockfile: true,
    activationTimeoutMs: 10_000,
    maxModuleBytes: 16 * 1024 * 1024,
    maxWasmBytes: 16 * 1024 * 1024,
    maxWasmMemoryBytes: 64 * 1024 * 1024,
  });
  await nodePluginRuntime.start();
  nodePluginRuntime.watch();
  ensureRegistrySubscription();
  return nodePluginRuntime;
}

export async function stopNodePluginRuntime() {
  if (!nodePluginRuntime) return;
  await nodePluginRuntime.stop();
  nodePluginRuntime = undefined;
  registrySubscription?.();
  registrySubscription = undefined;
  for (const client of registryClients) {
    try {
      client.end();
    } catch {
      // Ignore clients that disconnected concurrently.
    }
  }
  registryClients.clear();
}
