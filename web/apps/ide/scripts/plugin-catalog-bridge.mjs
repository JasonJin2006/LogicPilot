// Plugin catalog bridge (Phase 2B-1, ADR-0071 §6): mounts the Node-side
// catalog scanner behind a read-only GET endpoint for both the Vite dev
// middleware and the production app server. The browser only ever receives
// the validated catalog envelope; it never scans the filesystem itself.
//
// LOGICPILOT_PLUGIN_ROOTS (JSON: {"system":[...],"user":[...],"workspace":[...]})
// configures the scanned directories. Unset means no roots -> empty catalog.

import { createPrivateKey } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeSessionProvider } from './native-session-provider.mjs';

import {
  createPluginCatalogHandler,
  createPluginManagementHandler,
  FileSystemArtifactStore,
  FileSystemArtifactOutbox,
  FileSystemPluginDraftStore,
  AuditLog,
  PackageManager,
  PluginDraftPackageBuilder,
  PluginDraftValidationRunner,
  ed25519DraftSigner,
  PluginSignatureKeyring,
  FileSystemPackageStore,
  NodePluginRuntime,
  ExecutionTargetRegistry,
  pluginRootsFromEnv,
  FileSystemRegistryHistory,
  signPluginRegistry,
  ExecutionService,
  FileSystemExecutionRunStore,
} from '../../../packages/plugin-catalog/dist/index.bundle.js';

let nodePluginRuntime;
let executionTargetRegistry;
let executionService;
let executionRunStore;
let nativeExecutionDisposer;
const registryClients = new Set();
const registryHistory = [];
const REGISTRY_HISTORY_LIMIT = 32;
let registrySubscription;
let registryHistoryStore;
let registrySigner;
/** In-flight kernel runs keyed by execution requestId (one controller per
 * call; a retry with the same id aborts all of them). */
const kernelRuns = new Map();

/** Abort an in-flight kernel execution so the subprocess tree is reclaimed.
 * Safe to call for unknown or already-finished request ids. */
export function cancelKernelRun(requestId) {
  if (typeof requestId !== 'string') return;
  for (const controller of kernelRuns.get(requestId) ?? []) {
    try {
      controller.abort();
    } catch {
      // Already aborted or settled; cancellation is best effort.
    }
  }
}

/** GET /api/plugin-catalog[?scope=system|user|workspace] */
export function handlePluginCatalog(req, res) {
  return createPluginCatalogHandler({ roots: pluginRootsFromEnv(process.env) })(req, res);
}

/** GET /api/plugins: catalog plus sanitized installed/audit state.
 * POST /api/plugins: { action: 'uninstall', pluginId } - the operator-owned
 * lifecycle surface. Installation stays draft-gated (approval chain); removal
 * is an explicit user decision, so it gets the direct endpoint. */
export async function handlePlugins(req, res) {
  if (req.method === 'POST') return handlePluginLifecycle(req, res);
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

async function handlePluginLifecycle(req, res) {
  const send = (status, payload) => {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(payload));
  };
  let input;
  try {
    input = JSON.parse(await readArtifactBody(req));
  } catch {
    send(400, { ok: false, error: 'plugin lifecycle request body is not valid JSON' });
    return;
  }
  if (input?.action !== 'uninstall' || typeof input.pluginId !== 'string' || !input.pluginId) {
    send(400, {
      ok: false,
      error: "plugin lifecycle action 'uninstall' with a pluginId is required",
    });
    return;
  }
  const storeRoot = process.env.LOGICPILOT_PLUGIN_STORE_ROOT;
  if (!storeRoot) {
    send(503, { ok: false, error: 'plugin package store is not configured' });
    return;
  }
  const store = new FileSystemPackageStore({ rootDir: storeRoot });
  const manager = new PackageManager(store, new AuditLog());
  try {
    await manager.uninstall(input.pluginId);
  } catch (error) {
    const code = error?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'not-installed') {
      send(404, { ok: false, error: message });
      return;
    }
    if (code === 'dependency') {
      send(409, { ok: false, error: message });
      return;
    }
    if (code === 'invalid-manifest' || code === 'api-version') {
      send(400, { ok: false, error: message });
      return;
    }
    send(500, { ok: false, error: message });
    return;
  }
  // The lockfile no longer carries the plugin; swap the runtime generation so
  // its execution targets/sessions/services are revoked immediately instead
  // of waiting for the next watch tick. A failed hot-swap does not undo the
  // durable uninstall - the boundary is surfaced to the caller.
  let runtimeRefreshError;
  if (nodePluginRuntime) {
    try {
      await nodePluginRuntime.refresh();
    } catch (error) {
      runtimeRefreshError = error instanceof Error ? error.message : String(error);
    }
  }
  send(200, {
    ok: true,
    uninstalled: input.pluginId,
    installed: (store.readLockfile()?.plugins ?? []).map((entry) => entry.id),
    ...(runtimeRefreshError === undefined ? {} : { runtimeRefreshError }),
  });
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
        const crypto = await import('node:crypto');
        const privateKey = crypto.createPrivateKey({ key: signingKey, format: 'pem' });
        const signingKeyId = process.env.LOGICPILOT_PLUGIN_SIGNING_KEY_ID ?? 'local-signing-key';
        const keyring = new PluginSignatureKeyring();
        const configuredPublicKeys = process.env.LOGICPILOT_PLUGIN_SIGNING_PUBLIC_KEYS;
        if (configuredPublicKeys) {
          let parsedKeys;
          try {
            parsedKeys = JSON.parse(configuredPublicKeys);
          } catch {
            throw Object.assign(new Error('plugin signing public keyring is not valid JSON'), {
              status: 503,
            });
          }
          if (parsedKeys === null || typeof parsedKeys !== 'object' || Array.isArray(parsedKeys)) {
            throw Object.assign(new Error('plugin signing public keyring must be an object'), {
              status: 503,
            });
          }
          for (const [keyId, pem] of Object.entries(parsedKeys)) {
            if (typeof pem !== 'string')
              throw Object.assign(
                new Error('plugin signing public keyring values must be PEM strings'),
                { status: 503 },
              );
            keyring.add(keyId, crypto.createPublicKey(pem));
          }
        }
        if (!keyring.has(signingKeyId))
          keyring.add(signingKeyId, crypto.createPublicKey(privateKey));
        const signer = ed25519DraftSigner(signingKeyId, privateKey);
        const built = new PluginDraftPackageBuilder(buildRoot).build(current, signer);
        const packageStore = new FileSystemPackageStore({ rootDir: packageRoot });
        const manager = new PackageManager(packageStore, new AuditLog(), {
          verifySignature: (manifest, digest) => keyring.verify(manifest, digest),
        });
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
        let runtimeRefreshError;
        if (nodePluginRuntime) {
          try {
            await nodePluginRuntime.refresh();
          } catch (error) {
            // Installation is durable even if an already-running runtime
            // cannot hot-swap this generation; surface the exact boundary to
            // the review UI and let the next watch tick retry.
            runtimeRefreshError = error instanceof Error ? error.message : String(error);
          }
        }
        result = store.write({ ...current, status: 'published' });
        result = {
          draft: result,
          lockEntry,
          packageSha256: built.sha256,
          ...(runtimeRefreshError === undefined ? {} : { runtimeRefreshError }),
        };
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
  let payload;
  try {
    payload = registryPayload();
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ ok: false, error: 'plugin registry signing configuration is invalid' }),
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
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

function artifactOutboxFromEnv() {
  const root = process.env.LOGICPILOT_ARTIFACT_STORE_ROOT;
  return root ? new FileSystemArtifactOutbox({ rootDir: root }) : undefined;
}

let artifactOutboxDrain;

export async function drainArtifactOutbox(store, outbox) {
  if (artifactOutboxDrain) return artifactOutboxDrain;
  artifactOutboxDrain = (async () => {
    for (;;) {
      const entry = outbox.claimNext();
      if (!entry) break;
      try {
        try {
          store.artifact(entry.artifactId);
        } catch (error) {
          if (error?.code !== 'not-found') throw error;
          store.createArtifact({
            id: entry.artifactId,
            kind: entry.artifactKind,
            createdBy: entry.actor ?? 'runtime',
          });
        }
        const transaction = store.propose({
          id: `tx-${entry.digest}`,
          idempotencyKey: entry.idempotencyKey,
          proposedBy: entry.actor ?? 'runtime',
          artifactRefs: [{ artifactId: entry.artifactId }],
          operations: [
            { opId: `op-${entry.digest}`, opType: entry.operationType, payload: entry.payload },
          ],
        });
        store.validate(transaction.id);
        store.approve(transaction.id, entry.actor ?? 'runtime');
        const revision = store.commit({
          transactionId: transaction.id,
          revisionId: `rev-${entry.digest}`,
          artifactId: entry.artifactId,
          createdBy: entry.actor ?? 'runtime',
          digest: entry.digest,
        });
        outbox.complete(entry.id, revision.id, entry.leaseToken);
      } catch (error) {
        outbox.fail(
          entry.id,
          error instanceof Error ? error.message : String(error),
          entry.leaseToken,
        );
      }
    }
  })().finally(() => {
    artifactOutboxDrain = undefined;
  });
  return artifactOutboxDrain;
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
    const outbox = artifactOutboxFromEnv();
    if (outbox) await drainArtifactOutbox(store, outbox);
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
        case 'enqueue-background':
          if (!outbox)
            throw Object.assign(new Error('artifact outbox is not configured'), { status: 503 });
          result = outbox.enqueue(input.input ?? {});
          await drainArtifactOutbox(store, outbox);
          result = outbox.list().find((entry) => entry.id === result.id) ?? result;
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
  let current;
  try {
    current = registryPayload();
  } catch {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ ok: false, error: 'plugin registry signing configuration is invalid' }),
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  });
  rememberRegistrySnapshot(current);
  const lastEventId = Number(req.headers?.['last-event-id'] ?? 0);
  const replay = Number.isSafeInteger(lastEventId)
    ? registryHistory.filter((entry) => entry.generation > lastEventId)
    : [];
  if (replay.length > 0) {
    for (const entry of replay) res.write(registryEvent(entry));
  } else {
    res.write(registryEvent({ generation: current.generation, payload: current }));
  }
  registryClients.add(res);
  res.on('close', () => registryClients.delete(res));
  ensureRegistrySubscription();
}

function ensureRegistrySubscription() {
  if (registrySubscription || !nodePluginRuntime) return;
  registrySubscription = nodePluginRuntime.subscribe(() => {
    const payload = registryPayload();
    rememberRegistrySnapshot(payload);
    const event = registryEvent({ generation: payload.generation, payload });
    for (const client of [...registryClients]) {
      try {
        client.write(event);
      } catch {
        registryClients.delete(client);
      }
    }
  });
}

function rememberRegistrySnapshot(payload) {
  const generation = Number(payload.generation);
  if (!Number.isSafeInteger(generation)) return;
  if (registryHistory.some((entry) => entry.generation === generation)) return;
  if (registryHistoryStore) {
    try {
      registryHistoryStore.append(payload);
    } catch (error) {
      // Keep the live stream available, but make persistence failure visible
      // to the host logs; a later snapshot will retry the write.
      console.error('[plugin-registry] cannot persist history snapshot', error);
    }
  }
  registryHistory.push({ generation, payload });
  while (registryHistory.length > REGISTRY_HISTORY_LIMIT) registryHistory.shift();
}

function registryEvent(entry) {
  return `id: ${entry.generation}\nevent: registry\ndata: ${JSON.stringify(entry.payload)}\n\n`;
}

function registryPayload() {
  const snapshot = nodePluginRuntime?.snapshot();
  const registry = nodePluginRuntime?.contributionRegistry().snapshot();
  const payload = {
    schema: 'logicpilot.plugin-registry/v1',
    contractVersion: 1,
    generation: snapshot?.generation ?? registry?.generation ?? 0,
    plugins: snapshot?.host.ids() ?? [],
    contributions: (registry?.sets ?? []).map(sanitizeContributionSet),
  };
  const signer = getRegistrySigner();
  return signer == null ? payload : signPluginRegistry(payload, signer.signedBy, signer.privateKey);
}

function getRegistrySigner() {
  if (registrySigner !== undefined) return registrySigner;
  const pem = process.env.LOGICPILOT_PLUGIN_REGISTRY_SIGNING_PRIVATE_KEY;
  if (!pem) {
    registrySigner = null;
    return registrySigner;
  }
  try {
    registrySigner = {
      signedBy: process.env.LOGICPILOT_PLUGIN_REGISTRY_SIGNING_KEY_ID ?? 'registry-signing-key',
      privateKey: createPrivateKey({ key: pem, format: 'pem' }),
    };
    return registrySigner;
  } catch {
    throw new Error('plugin registry signing private key is invalid');
  }
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
  registryHistoryStore = new FileSystemRegistryHistory({ rootDir: storeRoot });
  try {
    registryHistory.push(...registryHistoryStore.read());
  } catch (error) {
    registryHistoryStore = undefined;
    throw new Error(
      `plugin registry history cannot be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const store = new FileSystemPackageStore({ rootDir: storeRoot });
  executionTargetRegistry = new ExecutionTargetRegistry();
  const executionStoreRoot = process.env.LOGICPILOT_EXECUTION_RUN_STORE_ROOT;
  executionRunStore = executionStoreRoot
    ? new FileSystemExecutionRunStore({ rootDir: executionStoreRoot })
    : undefined;
  executionService = new ExecutionService({
    registry: executionTargetRegistry,
    ...(executionRunStore === undefined ? {} : { store: executionRunStore }),
  });
  nodePluginRuntime = new NodePluginRuntime({
    roots: pluginRootsFromEnv(process.env),
    defaultTrustLevel: trust,
    readLockfile: () => store.readLockfile(),
    requireLockfile: true,
    activationTimeoutMs: 10_000,
    maxModuleBytes: 16 * 1024 * 1024,
    maxWasmBytes: 16 * 1024 * 1024,
    maxWasmMemoryBytes: 64 * 1024 * 1024,
    executionTargetRegistry,
    services: new Map([
      [
        'logicpilot.execution.kernel',
        async (input) => {
          if (!['process', 'devs', 'continuous', 'agent', 'generic'].includes(input?.runtimeKind))
            throw new Error('execution kernel runtimeKind is required');
          const root = process.env.LOGICPILOT_ROOT ?? process.cwd();
          const module = await import(
            pathToFileURL(join(root, 'scripts', 'runtime-adapters.mjs')).href
          );
          const requestId = typeof input?.requestId === 'string' ? input.requestId : undefined;
          const controller = new AbortController();
          let owners;
          if (requestId !== undefined) {
            owners = kernelRuns.get(requestId);
            if (owners === undefined) {
              owners = new Set();
              kernelRuns.set(requestId, owners);
            }
            owners.add(controller);
          }
          try {
            if (input.runtimeKind === 'generic') {
              const generic = await import(pathToFileURL(join(root, 'scripts', 'ai-build.mjs')).href);
              return await generic.runModelDsl({
                dsl: input.dsl,
                runParams: input.runParams,
                budget: input.budget,
                signal: controller.signal,
              });
            }
            return await module.runRuntimeModel({ ...input, signal: controller.signal });
          } finally {
            if (owners !== undefined) {
              owners.delete(controller);
              if (owners.size === 0) kernelRuns.delete(requestId);
            }
          }
        },
      ],
    ]),
  });
  await nodePluginRuntime.start();
  if (process.env.LOGICPILOT_ENABLE_NATIVE_SESSION_HOST === '1') {
    const host = process.env.LOGICPILOT_SESSION_HOST;
    if (!host) throw new Error('LOGICPILOT_SESSION_HOST is required for native session host');
    nativeExecutionDisposer = executionTargetRegistry.register(
      createNativeSessionProvider({ host }),
    );
  }
  nodePluginRuntime.watch();
  ensureRegistrySubscription();
  return nodePluginRuntime;
}

/** Returns the execution registry owned by the active Node PluginRuntime.
 * The HTTP execution surface uses this instead of maintaining a second
 * registry whenever Node plugins are enabled. */
export function getNodeExecutionTargetRegistry() {
  return nodePluginRuntime?.executionTargetRegistry() ?? null;
}

/** Shared execution orchestration boundary. It owns run identity and
 * idempotency while the registry remains the provider authority. */
export function getNodeExecutionService() {
  return executionService ?? null;
}

export async function stopNodePluginRuntime() {
  if (!nodePluginRuntime) return;
  await nodePluginRuntime.stop();
  nodePluginRuntime = undefined;
  executionTargetRegistry = undefined;
  executionService = undefined;
  executionRunStore = undefined;
  nativeExecutionDisposer?.();
  nativeExecutionDisposer = undefined;
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
  registryHistory.length = 0;
  registryHistoryStore = undefined;
  registrySigner = undefined;
}
