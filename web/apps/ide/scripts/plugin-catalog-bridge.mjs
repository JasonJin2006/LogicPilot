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
  FileSystemPackageStore,
  NodePluginRuntime,
  pluginRootsFromEnv,
} from '../../../packages/plugin-catalog/dist/index.bundle.js';

let nodePluginRuntime;

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
  return nodePluginRuntime;
}

export async function stopNodePluginRuntime() {
  if (!nodePluginRuntime) return;
  await nodePluginRuntime.stop();
  nodePluginRuntime = undefined;
}
