import { describe, expect, it } from 'vitest';
import type { PluginContributionSet, PluginManifest } from '@logicpilot/contracts';
import { PluginDraftRegistry } from '../src/index.js';

function manifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
    ...overrides,
  };
}

function contributions(pluginId: string): PluginContributionSet {
  return {
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
  };
}

describe('PluginDraftRegistry', () => {
  it('computes a permission diff and requires explicit approval before publish', () => {
    const registry = new PluginDraftRegistry();
    const draftManifest = manifest('logicpilot.derived', {
      permissions: ['knowledge.draft.write'],
    });
    const draft = registry.create({
      id: 'draft-1',
      baseManifest: manifest('logicpilot.base'),
      manifest: draftManifest,
      contributions: contributions(draftManifest.id),
      createdBy: 'agent',
      now: '2026-09-03T00:00:00Z',
    });
    expect(draft.permissionDiff.added).toEqual(['knowledge.draft.write']);
    expect(registry.validate('draft-1').status).toBe('validated');
    expect(() => registry.approve('draft-1', 'user')).toThrow(/explicit approval/);
    expect(registry.approve('draft-1', 'user', ['knowledge.draft.write']).status).toBe('approved');
    expect(registry.publish('draft-1').status).toBe('published');
  });

  it('rejects mismatched contribution ownership and blocks trust escalation', () => {
    const registry = new PluginDraftRegistry();
    const draftManifest = manifest('logicpilot.derived', { trust: { minLevel: 't2' } });
    registry.create({
      id: 'draft-2',
      baseManifest: manifest('logicpilot.base'),
      manifest: draftManifest,
      contributions: contributions('logicpilot.other'),
      createdBy: 'agent',
    });
    expect(registry.validate('draft-2').status).toBe('rejected');

    const valid = new PluginDraftRegistry();
    valid.create({
      id: 'draft-3',
      baseManifest: manifest('logicpilot.base'),
      manifest: draftManifest,
      contributions: contributions(draftManifest.id),
      createdBy: 'agent',
    });
    expect(valid.validate('draft-3').status).toBe('validated');
    expect(() => valid.approve('draft-3', 'user')).toThrow(/trust escalation/);
    expect(valid.approve('draft-3', 'user', [], true).status).toBe('approved');
  });
});
