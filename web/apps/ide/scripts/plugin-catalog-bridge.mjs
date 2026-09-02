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
  pluginRootsFromEnv,
} from '../../../packages/plugin-catalog/dist/index.bundle.js';

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
