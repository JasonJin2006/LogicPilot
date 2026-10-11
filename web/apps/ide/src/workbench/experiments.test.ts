import { describe, expect, it } from 'vitest';
import { parseDsl } from '@logicpilot/editor';
import { useRunStore } from '../state/runStore';
import {
  applyExperimentFields,
  experimentSignature,
  readExperiments,
  type DeclaredExperiment,
} from './experiments';

/** Parse real DSL text, so the test covers the whole chain: grammar -> node
 *  params -> this reader. Hand-built documents would not catch a parser change
 *  in how field lines reach `params`. */
function experimentsFrom(source: string): DeclaredExperiment[] {
  const result = parseDsl(source);
  expect(result.ok).toBe(true);
  return readExperiments(result.document);
}

const SIMULATION = `
model M {
  experiment Baseline {
    type = simulation
    replications = 4
    seed = 7
  }
}
`;

const ADAPTIVE = `
model M {
  experiment Adaptive {
    type = simulation
    seed_mode = random
    replication_mode = precision
    min_replications = 2
    max_replications = 8
    confidence = 0.95
    error_percent = 0.5
    metric = Wq
  }
}
`;

describe('readExperiments', () => {
  it('reads the fields a simulation experiment declares', () => {
    const [baseline] = experimentsFrom(SIMULATION);
    expect(baseline?.name).toBe('Baseline');
    expect(baseline?.type).toBe('simulation');
    expect(baseline?.reps).toBe(4);
    expect(baseline?.seed).toBe(7);
  });

  it('maps the DSL spellings onto the shell fields', () => {
    const [adaptive] = experimentsFrom(ADAPTIVE);
    expect(adaptive?.seedMode).toBe('random');
    expect(adaptive?.replicationMode).toBe('precision');
    expect(adaptive?.minReps).toBe(2);
    expect(adaptive?.maxReps).toBe(8);
    expect(adaptive?.confidence).toBe(0.95);
    expect(adaptive?.errorPercent).toBe(0.5);
    // `metric` is the DSL name for the shell's precision metric.
    expect(adaptive?.precisionMetric).toBe('Wq');
  });

  it('reports nothing for a model with no experiment block', () => {
    expect(experimentsFrom('model M {\n  param a: float = 1.0\n}\n')).toEqual([]);
  });

  it('leaves undeclared fields null instead of inventing defaults', () => {
    const [sparse] = experimentsFrom(`
model M {
  experiment Sparse {
    type = simulation
  }
}
`);
    expect(sparse?.type).toBe('simulation');
    expect(sparse?.seed).toBeNull();
    expect(sparse?.reps).toBeNull();
    expect(sparse?.confidence).toBeNull();
    expect(sparse?.seedMode).toBeNull();
  });

  it('rejects junk and out-of-vocabulary values rather than passing them through', () => {
    const [odd] = experimentsFrom(`
model M {
  experiment Odd {
    type = simulation
    seed = abc
    seed_mode = sideways
    replications = 2
  }
}
`);
    expect(odd?.seed).toBeNull();
    expect(odd?.seedMode).toBeNull();
    expect(odd?.reps).toBe(2);
  });

  it('keeps every declared experiment in document order', () => {
    const both = experimentsFrom(`
model M {
  experiment Baseline {
    type = simulation
    replications = 4
    seed = 7
  }
  experiment Adaptive {
    type = simulation
    replication_mode = precision
    metric = Wq
  }
}
`);
    expect(both.map((experiment) => experiment.name)).toEqual(['Baseline', 'Adaptive']);
  });
});

describe('applyExperimentFields', () => {
  const base = useRunStore.getState().runOptions;

  it('overwrites only the fields the model declares', () => {
    const [baseline] = experimentsFrom(SIMULATION);
    const applied = applyExperimentFields(base, baseline!);
    expect(applied.seed).toBe(7);
    expect(applied.reps).toBe(4);
    // Undeclared model-owned fields keep their prior value.
    expect(applied.confidence).toBe(base.confidence);
  });

  it('never writes the run-level fields', () => {
    const [adaptive] = experimentsFrom(ADAPTIVE);
    const applied = applyExperimentFields(base, adaptive!);
    expect(applied.warmup).toBe(base.warmup);
    expect(applied.arrivals).toBe(base.arrivals);
    expect(applied.executionMode).toBe(base.executionMode);
    expect(applied.speed).toBe(base.speed);
  });
});

describe('experimentSignature', () => {
  it('is stable across identical declarations so typing cannot be clobbered', () => {
    const [first] = experimentsFrom(SIMULATION);
    const [second] = experimentsFrom(SIMULATION);
    expect(experimentSignature(first!)).toBe(experimentSignature(second!));
  });

  it('changes when the declaration changes, and is empty for no experiment', () => {
    const [baseline] = experimentsFrom(SIMULATION);
    const [adaptive] = experimentsFrom(ADAPTIVE);
    expect(experimentSignature(baseline!)).not.toBe(experimentSignature(adaptive!));
    expect(experimentSignature(null)).toBe('');
  });
});
