import { describe, expect, it } from 'vitest';
import { ContributionRegistry } from '../src/index.js';

function emptySet(pluginId: string) {
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
    palettes: [],
    tools: [],
  };
}

describe('ContributionRegistry', () => {
  it('prepares and atomically commits validated generations', () => {
    const registry = new ContributionRegistry();
    const updates: number[] = [];
    registry.subscribe((snapshot) => updates.push(snapshot.generation));
    const prepared = registry.prepare([emptySet('logicpilot.contrib-a')]);
    expect(registry.snapshot().generation).toBe(0);
    const committed = registry.commit(prepared);
    expect(committed.generation).toBe(1);
    expect(committed.sets[0]?.pluginId).toBe('logicpilot.contrib-a');
    expect(updates).toEqual([1]);
  });

  it('rejects invalid, duplicate-plugin and stale generations without changing active state', () => {
    const registry = new ContributionRegistry();
    expect(() => registry.prepare([{ pluginId: 'bad' }])).toThrow(/invalid plugin contributions/);
    expect(() =>
      registry.prepare([emptySet('logicpilot.dup'), emptySet('logicpilot.dup')]),
    ).toThrow(/duplicate contribution plugin/);
    const prepared = registry.prepare([emptySet('logicpilot.ok')]);
    registry.commit(prepared);
    expect(() => registry.commit(prepared)).toThrow(/stale contribution generation/);
    expect(registry.snapshot().sets[0]?.pluginId).toBe('logicpilot.ok');
  });
});
