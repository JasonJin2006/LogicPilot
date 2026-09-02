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
  FileSystemPluginDraftStore,
  AuditLog,
  PackageManager,
  PluginDraftPackageBuilder,
  PluginDraftValidationRunner,
  ed25519DraftSigner,
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

function draftStoreFromEnv() {
  const root = process.env.LOGICPILOT_PLUGIN_DRAFT_ROOT;
  return root ? new FileSystemPluginDraftStore({ rootDir: root }) : undefined;
}

function sendDraftJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

/** GET/POST /api/plugin-drafts: persisted draft review lifecycle. This route
 * never installs packages or mutates the plugin lockfile. */
export async function handlePluginDrafts(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    sendDraftJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  const store = draftStoreFromEnv();
  if (!store) {
    if (req.method === 'GET') {
      sendDraftJson(res, 200, {
        schema: 'logicpilot.plugin-drafts/v1',
        contractVersion: 1,
        configured: false,
        drafts: [],
      });
    } else {
      sendDraftJson(res, 503, { ok: false, error: 'plugin draft store is not configured' });
    }
    return;
  }
  try {
    if (req.method === 'GET') {
      const drafts = store.list();
      const validator = new PluginDraftValidationRunner();
      sendDraftJson(res, 200, {
        schema: 'logicpilot.plugin-drafts/v1',
        contractVersion: 1,
        configured: true,
        drafts: drafts.map((draft) => ({
          ...draft,
          validation: validator.run(draft),
        })),
      });
      return;
    }
    const raw = await readArtifactBody(req);
    let input;
    try {
      input = JSON.parse(raw || '{}');
    } catch {
      throw Object.assign(new Error('request body is not valid JSON'), { status: 400 });
    }
    if (typeof input !== 'object' || input === null || typeof input.action !== 'string') {
      throw Object.assign(new Error('plugin draft action is required'), { status: 400 });
    }
    const action = input.action;
    let result;
    if (action === 'create') {
      const draft = input.draft;
      if (draft?.status !== 'draft')
        throw Object.assign(new Error('new plugin drafts must start in draft status'), {
          status: 400,
        });
      const report = new PluginDraftValidationRunner().run(draft);
      if (!report.ok) {
        sendDraftJson(res, 400, { ok: false, error: 'plugin draft validation failed', report });
        return;
      }
      result = store.write(draft);
    } else {
      const id = typeof input.id === 'string' ? input.id : '';
      const current = store.read(id);
      if (action === 'validate') {
        const report = new PluginDraftValidationRunner().run(current);
        result = store.write({
          ...current,
          status: report.ok ? 'validated' : 'rejected',
          validatedAt: new Date().toISOString(),
          ...(report.ok ? {} : { diagnostics: report.diagnostics }),
        });
      } else if (action === 'approve') {
        if (current.status !== 'validated')
          throw Object.assign(new Error('plugin draft is not validated'), { status: 400 });
        const accepted = Array.isArray(input.acceptedPermissions)
          ? input.acceptedPermissions.filter((value) => typeof value === 'string')
          : [];
        const added = current.permissionDiff.added;
        if (added.some((permission) => !accepted.includes(permission)))
          throw Object.assign(new Error('all added permissions require explicit approval'), {
            status: 400,
          });
        if (current.permissionDiff.trustEscalation !== true && input.allowTrustEscalation === true)
          throw Object.assign(new Error('trust escalation was not requested'), { status: 400 });
        if (current.permissionDiff.trustEscalation === true && input.allowTrustEscalation !== true)
          throw Object.assign(new Error('trust escalation requires explicit approval'), {
            status: 400,
          });
        result = store.write({
          ...current,
          status: 'approved',
          approvedBy: typeof input.approvedBy === 'string' ? input.approvedBy : 'user',
          approvedAt: new Date().toISOString(),
        });
      } else if (action === 'publish') {
        if (current.status !== 'approved')
          throw Object.assign(new Error('plugin draft is not approved'), { status: 400 });
        result = store.write({ ...current, status: 'published' });
      } else if (action === 'install') {
        if (current.status !== 'approved' && current.status !== 'published')
          throw Object.assign(new Error('plugin draft is not approved'), { status: 400 });
        const packageRoot = process.env.LOGICPILOT_PLUGIN_STORE_ROOT;
        const signingKey = process.env.LOGICPILOT_PLUGIN_SIGNING_PRIVATE_KEY;
        if (!packageRoot || !signingKey)
          throw Object.assign(new Error('plugin package store or signing key is not configured'), {
            status: 503,
          });
        const buildRoot = process.env.LOGICPILOT_PLUGIN_BUILD_ROOT ?? `${packageRoot}/draft-builds`;
        const signer = ed25519DraftSigner(
          process.env.LOGICPILOT_PLUGIN_SIGNING_KEY_ID ?? 'local-signing-key',
          (await import('node:crypto')).createPrivateKey({ key: signingKey, format: 'pem' }),
        );
        const built = new PluginDraftPackageBuilder(buildRoot).build(current, signer);
        const packageStore = new FileSystemPackageStore({ rootDir: packageRoot });
        const manager = new PackageManager(packageStore, new AuditLog());
        const lockEntry = await manager.install({
          manifestJson: built.manifest,
          sha256: built.sha256,
          source: 'ai-draft',
          packagePath: built.packagePath,
          grants: built.manifest.permissions.map((permissionId) => ({
            permissionId,
            granted: true,
            grantedBy: current.approvedBy ?? 'user',
            grantedAt: current.approvedAt ?? new Date().toISOString(),
          })),
        });
        result = store.write({ ...current, status: 'published' });
        result = { draft: result, lockEntry, packageSha256: built.sha256 };
      } else if (action === 'reject') {
        result = store.write({
          ...current,
          status: 'rejected',
          diagnostics: [
            ...(current.diagnostics ?? []),
            typeof input.reason === 'string' ? input.reason : 'rejected by user',
          ],
        });
      } else {
        throw Object.assign(new Error(`unsupported plugin draft action '${action}'`), {
          status: 400,
        });
      }
    }
    sendDraftJson(res, 200, {
      schema: 'logicpilot.plugin-draft-operation/v1',
      contractVersion: 1,
      action,
      result,
    });
  } catch (error) {
    const status =
      error?.status ?? (error?.code === 'not-found' ? 404 : error?.code === 'invalid' ? 400 : 500);
    sendDraftJson(res, status, {
      ok: false,
      error: String(error?.message ?? 'plugin draft unavailable'),
    });
  }
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
