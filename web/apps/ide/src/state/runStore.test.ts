import { describe, expect, it } from 'vitest';

import { validateRunOptions, type RunOptions } from './runStore';

const valid: RunOptions = {
  seed: 42,
  seedMode: 'fixed',
  reps: 10,
  replicationMode: 'fixed',
  minReps: 5,
  maxReps: 100,
  errorPercent: 5,
  precisionMetric: 'Wq',
  arrivals: 4000,
  warmup: 400,
  confidence: 0.95,
  speed: 10,
};

describe('validateRunOptions', () => {
  it('accepts a reproducible replication experiment', () => {
    expect(validateRunOptions(valid)).toBeNull();
  });

  it('rejects invalid replication and warm-up settings', () => {
    expect(validateRunOptions({ ...valid, reps: 0 })).toMatch(/reps/);
    expect(validateRunOptions({ ...valid, warmup: 4000 })).toMatch(/warmup/);
    expect(validateRunOptions({ ...valid, confidence: 1 })).toMatch(/confidence/);
  });

  it('validates precision-driven replication bounds', () => {
    expect(validateRunOptions({ ...valid, replicationMode: 'precision' })).toBeNull();
    expect(
      validateRunOptions({ ...valid, replicationMode: 'precision', minReps: 10, maxReps: 5 }),
    ).toMatch(/maxReps/);
    expect(validateRunOptions({ ...valid, replicationMode: 'precision', errorPercent: 0 })).toMatch(
      /errorPercent/,
    );
  });
});
