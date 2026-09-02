import { describe, expect, it } from 'vitest';
import { PluginDraftValidationRunner } from '../src/index.js';

function draft(overrides: Record<string, unknown> = {}) {
  const pluginId = 'logicpilot.derived';
  return {
    schema: 'logicpilot.plugin-draft/v1',
    contractVersion: 1,
    id: 'draft-validation',
    basePluginId: 'logicpilot.base',
    manifest: {
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
    },
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
    status: 'validated',
    createdBy: 'agent',
    createdAt: '2026-09-03T00:00:00Z',
    permissionDiff: { added: [], removed: [] },
    ...overrides,
  };
}

describe('PluginDraftValidationRunner', () => {
  it('passes a structurally valid data-only draft', () => {
    const result = new PluginDraftValidationRunner().run(draft());
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      schema: 'passed',
      ownership: 'passed',
      ids: 'passed',
      permissions: 'passed',
      trust: 'passed',
      references: 'passed',
    });
  });

  it('fails closed on undeclared permissions and unsafe entrypoints', () => {
    const value = draft({
      manifest: {
        ...draft().manifest,
        entrypoints: { node: 'index.js' },
        permissions: [],
        trust: { minLevel: 't0' },
      },
      contributions: {
        ...draft().contributions,
        tools: [
          {
            id: 'tool.one',
            name: 'tool.one',
            capability: 'tool.one',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'object' },
            permissions: ['runtime.storage.read'],
          },
        ],
      },
    });
    const result = new PluginDraftValidationRunner().run(value);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/undeclared permissions/);
    expect(result.diagnostics.join('\n')).toMatch(/below entrypoint requirement/);
  });
});
