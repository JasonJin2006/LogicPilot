import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemPluginDraftStore, PluginDraftStoreError } from '../src/node.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function draft(id = 'draft/one') {
  const pluginId = 'logicpilot.derived';
  const manifest = {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: pluginId,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
  } as const;
  return {
    schema: 'logicpilot.plugin-draft/v1',
    contractVersion: 1,
    id,
    basePluginId: 'logicpilot.base',
    manifest,
    contributions: {
      schema: 'logicpilot.plugin-contributions/v1',
      contractVersion: 1,
      pluginId,
      version: '1.0.0',
      knowledge: [],
      skills: [],
      instructions: [],
      diagnostics: [],
      views: [],
      notations: [],
      createActions: [],
      palettes: [],
      tools: [],
    },
    status: 'draft',
    createdBy: 'agent',
    createdAt: '2026-09-03T00:00:00Z',
    permissionDiff: { added: [], removed: [] },
  } as const;
}

describe('FileSystemPluginDraftStore', () => {
  it('round-trips drafts with path-safe ids and lists them deterministically', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-plugin-drafts-'));
    roots.push(root);
    const store = new FileSystemPluginDraftStore({ rootDir: root });
    store.write(draft());
    store.write(draft('draft/two'));
    expect(store.read('draft/one').id).toBe('draft/one');
    expect(store.list().map((item) => item.id)).toEqual(['draft/one', 'draft/two']);
    store.remove('draft/one');
    expect(() => store.read('draft/one')).toThrow(PluginDraftStoreError);
  });

  it('rejects malformed stored drafts instead of returning unvalidated data', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-plugin-drafts-invalid-'));
    roots.push(root);
    const store = new FileSystemPluginDraftStore({ rootDir: root });
    store.write(draft('bad'));
    writeFileSync(join(root, 'bad.json'), '{not-json', 'utf8');
    expect(() => store.read('bad')).toThrow(/not valid JSON/);
  });
});
