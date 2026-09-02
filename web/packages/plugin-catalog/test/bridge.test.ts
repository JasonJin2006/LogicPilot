// Bridge gate tests (Phase 2B-1, ADR-0071 §6): the local HTTP handler returns
// only the validated catalog, restricts scope parameters, rejects non-GET,
// and parses LOGICPILOT_PLUGIN_ROOTS with fail-fast configuration errors.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPluginCatalogHandler, pluginRootsFromEnv } from '../src/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

let fixtureSeq = 0;
const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  fixtureSeq += 1;
  const dir = mkdtempSync(join(tmpdir(), `lp-plugin-bridge-${process.pid}-${fixtureSeq}-`));
  cleanups.push(dir);
  return dir;
}

function writePlugin(dir: string, overrides: Record<string, unknown> = {}): void {
  const manifest: Record<string, unknown> = {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: `logicpilot.bridge-${fixtureSeq}-${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
    ...overrides,
  };
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest));
}

function fakeRequest(method: string, url: string): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

function fakeResponse() {
  const state = {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
  };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      state.status = status;
      state.headers = headers;
      return res;
    },
    end(body?: string) {
      state.body = body ?? '';
      return res;
    },
  } as unknown as ServerResponse;
  return { res, state };
}

describe('plugin catalog bridge', () => {
  it('serves the catalog with no-store headers', async () => {
    const root = tempRoot();
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    writePlugin(pkg, { id: 'logicpilot.bridge-ok' });
    const handler = createPluginCatalogHandler({
      roots: [{ scope: 'workspace', path: root }],
    });
    const { res, state } = fakeResponse();
    await handler(fakeRequest('GET', '/api/plugin-catalog'), res);
    expect(state.status).toBe(200);
    expect(state.headers['cache-control']).toBe('no-store');
    const payload = JSON.parse(state.body) as {
      entries: { id: string; scope: string }[];
    };
    expect(payload.entries).toEqual([
      expect.objectContaining({ id: 'logicpilot.bridge-ok', scope: 'workspace' }),
    ]);
  });

  it('filters entries, roots and diagnostics by scope', async () => {
    const systemRoot = tempRoot();
    const workspaceRoot = tempRoot();
    const systemPkg = join(systemRoot, 'sys');
    mkdirSync(systemPkg);
    writePlugin(systemPkg, { id: 'logicpilot.bridge-sys' });
    const workspacePkg = join(workspaceRoot, 'ws');
    mkdirSync(workspacePkg);
    writePlugin(workspacePkg, { id: 'logicpilot.bridge-ws' });
    const handler = createPluginCatalogHandler({
      roots: [
        { scope: 'system', path: systemRoot },
        { scope: 'workspace', path: workspaceRoot },
      ],
    });

    const { res, state } = fakeResponse();
    await handler(fakeRequest('GET', '/api/plugin-catalog?scope=workspace'), res);
    const payload = JSON.parse(state.body) as {
      roots: { id: string }[];
      entries: { id: string }[];
      diagnostics: unknown[];
    };
    expect(payload.entries.map((entry) => entry.id)).toEqual(['logicpilot.bridge-ws']);
    expect(payload.roots.map((root) => root.id)).toEqual(['workspace:1']);
  });

  it('rejects unknown scopes with a 400 and non-GET with a 405', async () => {
    const handler = createPluginCatalogHandler({ roots: [] });
    const badScope = fakeResponse();
    await handler(fakeRequest('GET', '/api/plugin-catalog?scope=admin'), badScope.res);
    expect(badScope.state.status).toBe(400);
    const post = fakeResponse();
    await handler(fakeRequest('POST', '/api/plugin-catalog'), post.res);
    expect(post.state.status).toBe(405);
  });
});

describe('pluginRootsFromEnv', () => {
  it('parses scoped root arrays in canonical order', () => {
    const roots = pluginRootsFromEnv({
      LOGICPILOT_PLUGIN_ROOTS: JSON.stringify({
        workspace: ['C:/proj/.logicpilot/plugins'],
        system: ['C:/app/plugins'],
        user: ['C:/users/demo/Plugins'],
      }),
    });
    expect(roots.map((root) => root.scope)).toEqual(['system', 'user', 'workspace']);
    expect(roots[1]?.path).toBe('C:/users/demo/Plugins');
  });

  it('returns no roots when unset and throws on malformed configuration', () => {
    expect(pluginRootsFromEnv({})).toEqual([]);
    expect(() => pluginRootsFromEnv({ LOGICPILOT_PLUGIN_ROOTS: '{oops' })).toThrow(/valid JSON/);
    expect(() =>
      pluginRootsFromEnv({ LOGICPILOT_PLUGIN_ROOTS: JSON.stringify({ system: 'nope' }) }),
    ).toThrow(/array of non-empty/);
  });
});
