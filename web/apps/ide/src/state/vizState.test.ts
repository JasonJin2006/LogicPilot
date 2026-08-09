import { describe, expect, it } from 'vitest';
import {
  createVizState,
  departedDelta,
  parseBlockCounters,
  resetVizState,
  vizState,
} from './vizState';

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

describe('flow token baseline', () => {
  it('round 2 spawns tokens from a fresh baseline after a reset', () => {
    // Round 1: the run advanced to departed = 100 (baseline recorded).
    const viz = createVizState();
    viz.lastDeparted.set('S', 100);
    viz.blocks.set('S', { buffered: 0, inService: 0, arrived: 100, departed: 100 });
    expect(departedDelta(viz.lastDeparted.get('S') ?? 0, viz.blocks.get('S')!.departed)).toBe(0);

    // New run starts: resetVizState clears the baseline (and bumps the
    // generation so the renderer drops in-flight tokens).
    const generation = viz.tokenGeneration;
    resetVizState(viz);
    expect(viz.lastDeparted.size).toBe(0);
    expect(viz.tokenGeneration).toBe(generation + 1);

    // Round 2: departed = 1 must produce a token delta - the old baseline
    // of 100 must not suppress it.
    viz.blocks.set('S', { buffered: 0, inService: 0, arrived: 1, departed: 1 });
    expect(departedDelta(viz.lastDeparted.get('S') ?? 0, viz.blocks.get('S')!.departed)).toBe(1);
    viz.lastDeparted.set('S', 1);

    // The baseline advances with the counter; a stalled counter emits
    // nothing further.
    expect(departedDelta(viz.lastDeparted.get('S') ?? 0, 1)).toBe(0);
    // A big jump is capped per frame.
    expect(departedDelta(viz.lastDeparted.get('S') ?? 0, 7)).toBe(4);
    expect(departedDelta(0, 1000)).toBe(4);
  });
});
