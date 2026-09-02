import { describe, expect, it, vi } from 'vitest';
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
        notations: [],
        createActions: [],
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
    expect(store.apply(envelope(1)).generation).toBe(1);
    expect(updates).toBe(1);
    expect(() => store.apply(envelope(0))).toThrow(/stale/);
  });

  it('retains registry integrity metadata for an external verifier', () => {
    const store = new PluginRegistryStore();
    store.apply({
      ...envelope(1),
      integrity: { sha256: 'a'.repeat(64), signedBy: 'registry-key', signature: 'sig' },
    });
    expect(store.snapshot().integrity).toEqual({
      sha256: 'a'.repeat(64),
      signedBy: 'registry-key',
      signature: 'sig',
    });
  });

  it('rejects malformed contribution payloads without mutating the active state', () => {
    const store = new PluginRegistryStore();
    store.apply(envelope(1));
    const malformed = envelope(2);
    malformed.contributions[0]!.pluginId = 'wrong';
    expect(() => store.apply(malformed)).toThrow(/invalid plugin contribution/);
    expect(store.snapshot().generation).toBe(1);
  });

  it('applies an SSE snapshot and can stop the reconnect loop', async () => {
    const store = new PluginRegistryStore();
    const payload = envelope(1);
    const responseBody = () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(`event: registry\ndata: ${JSON.stringify(payload)}\n\n`),
          );
          controller.close();
        },
      });
      return stream;
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: responseBody() }));
    const stop = store.startLive({ fetch: fetchImpl, retryBaseMs: 1, retryMaxMs: 4 });
    await vi.waitFor(() => expect(store.snapshot().generation).toBe(1));
    stop();
    expect(store.snapshot().plugins).toEqual(['logicpilot.registry-test']);
  });
});
