import { describe, expect, it } from 'vitest';
import { PluginRegistryStore } from './registry';

function envelope(generation: number) {
  return {
    schema: 'logicpilot.plugin-registry/v1',
    contractVersion: 1,
    generation,
    plugins: ['logicpilot.registry-test'],
    contributions: [
      {
        schema: 'logicpilot.plugin-contributions/v1',
        contractVersion: 1,
        pluginId: 'logicpilot.registry-test',
        version: '1.0.0',
        knowledge: [],
        skills: [],
        instructions: [],
        diagnostics: [],
        views: [],
        palettes: [],
        tools: [],
      },
    ],
  };
}

describe('PluginRegistryStore', () => {
  it('replaces the complete snapshot atomically by generation', () => {
    const store = new PluginRegistryStore();
    let updates = 0;
    store.subscribe(() => {
      updates += 1;
    });
    expect(store.apply(envelope(1)).generation).toBe(1);
    expect(store.snapshot().contributions[0]?.pluginId).toBe('logicpilot.registry-test');
    expect(updates).toBe(1);
    expect(() => store.apply(envelope(0))).toThrow(/stale/);
  });

  it('rejects malformed contribution payloads without mutating the active state', () => {
    const store = new PluginRegistryStore();
    store.apply(envelope(1));
    const malformed = envelope(2);
    malformed.contributions[0]!.pluginId = 'wrong';
    expect(() => store.apply(malformed)).toThrow(/invalid plugin contribution/);
    expect(store.snapshot().generation).toBe(1);
  });
});
