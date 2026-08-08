import { describe, expect, it } from 'vitest';
import { parseBlockCounters, resetVizState, vizState } from './vizState';

describe('parseBlockCounters', () => {
  it('maps generic flow counters into per-block live state', () => {
    const blocks = parseBlockCounters({
      'block.Queue.buffered': 4,
      'block.Queue.in_service': 0,
      'block.Queue.arrived': 12,
      'block.Queue.departed': 8,
      'block.Server.buffered': 1,
      'block.Server.in_service': 2.9,
      'block.Server.arrived': 10.5,
      'block.Server.departed': 7,
      queue_length: 99, // non-block counter is ignored
    });
    expect(blocks.size).toBe(2);
    expect(blocks.get('Queue')).toEqual({ buffered: 4, inService: 0, arrived: 12, departed: 8 });
    // Values are rounded and clamped to non-negative integers.
    expect(blocks.get('Server')).toEqual({ buffered: 1, inService: 3, arrived: 11, departed: 7 });
  });

  it('ignores counters that are not per-block telemetry', () => {
    expect(parseBlockCounters({ busy: 1, throughput: 0.8 }).size).toBe(0);
  });

  it('reset clears the block map and bumps the version', () => {
    vizState.blocks = new Map([['Q', { buffered: 1, inService: 0, arrived: 1, departed: 0 }]]);
    const before = vizState.tickVersion;
    resetVizState(vizState);
    expect(vizState.blocks.size).toBe(0);
    expect(vizState.tickVersion).toBeGreaterThan(before);
  });
});
