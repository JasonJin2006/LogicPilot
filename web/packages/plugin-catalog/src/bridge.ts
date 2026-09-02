// Local HTTP bridge for the plugin catalog (ADR-0071 §6): a read-only GET
// endpoint mounted by the Vite dev middleware and the production app server.
// It exposes ONLY the validated catalog envelope - no file contents, no
// filesystem paths - so the browser never scans the disk itself.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginCatalog, PluginScope } from '@logicpilot/plugin-host';
import { isPluginScope } from '@logicpilot/plugin-host';
import { scanPluginCatalog } from './catalog.js';
import type { PluginCatalogScanConfig, PluginRootConfig } from './catalog.js';

export interface PluginCatalogBridgeHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** Creates the GET /api/plugin-catalog handler. Scans on every request so
 *  the catalog is always fresh; catalogs are tiny in this slice (caching is
 *  a Phase 2B-2 concern, ADR-0071 §6). */
export function createPluginCatalogHandler(
  config: PluginCatalogScanConfig,
): PluginCatalogBridgeHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://logicpilot.invalid');
    const scope = url.searchParams.get('scope');
    if (scope !== null && !isPluginScope(scope)) {
      sendJson(res, 400, { ok: false, error: `invalid scope '${scope}'` });
      return;
    }
    try {
      const catalog = await scanPluginCatalog(config);
      sendJson(res, 200, scope === null ? catalog : filterByScope(catalog, scope));
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: `plugin catalog scan failed: ${(error as Error).message}`,
      });
    }
  };
}

/** Parses LOGICPILOT_PLUGIN_ROOTS: {"system":[...],"user":[...],"workspace":[...]},
 *  in canonical scope order. Throws on malformed configuration so a
 *  misconfigured server fails loudly instead of silently scanning nothing. */
export function pluginRootsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): PluginRootConfig[] {
  const raw = env.LOGICPILOT_PLUGIN_ROOTS;
  if (raw === undefined || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LOGICPILOT_PLUGIN_ROOTS must be valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LOGICPILOT_PLUGIN_ROOTS must be a JSON object');
  }
  const object = parsed as Record<string, unknown>;
  const roots: PluginRootConfig[] = [];
  for (const scope of ['system', 'user', 'workspace'] as const) {
    const value = object[scope];
    if (value === undefined) continue;
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== 'string' || entry.length === 0)
    ) {
      throw new Error(
        `LOGICPILOT_PLUGIN_ROOTS.${scope} must be an array of non-empty path strings`,
      );
    }
    for (const path of value) roots.push({ scope, path });
  }
  return roots;
}

function filterByScope(catalog: PluginCatalog, scope: PluginScope): PluginCatalog {
  return {
    schema: catalog.schema,
    contractVersion: catalog.contractVersion,
    roots: catalog.roots.filter((root) => root.scope === scope),
    entries: catalog.entries.filter((entry) => entry.scope === scope),
    diagnostics: catalog.diagnostics.filter(
      (diagnostic) => diagnostic.scope === undefined || diagnostic.scope === scope,
    ),
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: { ok: boolean; error?: string } | PluginCatalog,
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}
