import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileSystemRegistryHistory } from '../src/index.js';
import type { PluginRegistry } from '@logicpilot/contracts';

function payload(generation: number): PluginRegistry {
  return {
    schema: 'logicpilot.plugin-registry/v1',
    contractVersion: 1,
    generation,
    plugins: [],
    contributions: [],
  };
}

describe('FileSystemRegistryHistory', () => {
  it('round-trips bounded snapshots and replays after a generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-registry-history-'));
    try {
      const history = new FileSystemRegistryHistory({ rootDir: root, maxEntries: 2 });
      history.append(payload(1));
      history.append(payload(2));
      history.append(payload(3));
      history.append(payload(3));
      expect(history.read().map((entry) => entry.generation)).toEqual([2, 3]);
      expect(history.readSince(1).map((entry) => entry.generation)).toEqual([2, 3]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed persisted payloads', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-registry-history-invalid-'));
    try {
      const history = new FileSystemRegistryHistory({ rootDir: root });
      expect(() => history.append({ ...payload(1), generation: -1 })).toThrow(/registry payload/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
