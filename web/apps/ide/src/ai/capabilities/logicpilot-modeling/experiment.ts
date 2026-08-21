import type { ExperimentSettings } from '../../api';
import { useRunStore } from '../../../state/runStore';

export function currentExperiment(): ExperimentSettings {
  const { runOptions } = useRunStore.getState();
  return {
    seed: runOptions.seed,
    seedMode: runOptions.seedMode,
    reps: runOptions.reps,
    replicationMode: runOptions.replicationMode,
    minReps: runOptions.minReps,
    maxReps: runOptions.maxReps,
    errorPercent: runOptions.errorPercent,
    precisionMetric: runOptions.precisionMetric,
    arrivals: runOptions.arrivals,
    warmup: runOptions.warmup,
    confidence: runOptions.confidence,
  };
}
