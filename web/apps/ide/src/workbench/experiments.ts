// Model-declared experiments, read straight out of the authoritative document.
//
// Ownership is fixed by `docs/specs/dsl-freeze.md` §3: the `experiment` block
// owns reproducibility and precision (the seed / replications family), while
// the shell owns per-run settings (warmup, termination, execution mode,
// speed). This module reads **only the model's half**, so the run dialog can
// present those values as the model's declaration instead of as an independent
// setting that happens to duplicate it.
//
// The experiment block is a plain DSL member (`dsl-spec` R12), so it already
// lives in `document.nodes` as a node whose field lines were merged into
// `params` by the parser. Adding a paradigm pack needs no change here: the
// reader keys off the block's shape, not off a paradigm name.

import type { ModelDocument } from '@logicpilot/editor';
import type { RunOptions } from '../state/runStore';

/** Fields the `experiment` block owns. The shell must not offer a second
 *  editable source for any of them. */
export const EXPERIMENT_OWNED_FIELDS = [
  'seed',
  'seedMode',
  'reps',
  'replicationMode',
  'minReps',
  'maxReps',
  'errorPercent',
  'precisionMetric',
  'confidence',
] as const;

/** Fields that belong to one run, not to the model. `arrivals` is the
 *  termination condition: "run until this many arrivals", a per-run setting
 *  (`dsl-spec` §5 keeps warm-up / run-length at run level). */
export const RUN_LEVEL_FIELDS = ['arrivals', 'warmup', 'executionMode', 'speed'] as const;

/** One `experiment <Name> { ... }` block, with the fields the shell cares
 *  about resolved. Absent fields stay `null` so the caller can tell "the model
 *  did not say" apart from "the model said zero". */
export interface DeclaredExperiment {
  name: string;
  /** The `type` field verbatim (`simulation`, `parameter_variation`, ...). */
  type: string | null;
  seed: number | null;
  seedMode: 'fixed' | 'random' | null;
  reps: number | null;
  replicationMode: 'fixed' | 'precision' | null;
  minReps: number | null;
  maxReps: number | null;
  errorPercent: number | null;
  precisionMetric: string | null;
  confidence: number | null;
}

/** DSL field name -> shell field name. The DSL spelling is the frozen
 *  experiment grammar (`dsl-spec` R12); the shell spelling is what the run
 *  dialog and the wire use. Reading goes through the **DSL** name, since that
 *  is what the parser put into `params`. */
const FIELD_ALIASES = {
  seed: 'seed',
  seed_mode: 'seedMode',
  replications: 'reps',
  replication_mode: 'replicationMode',
  min_replications: 'minReps',
  max_replications: 'maxReps',
  error_percent: 'errorPercent',
  metric: 'precisionMetric',
  confidence: 'confidence',
} as const;

function toNumber(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: string | number | boolean | undefined): string | null {
  return value === undefined || value === '' ? null : String(value);
}

function toEnum<T extends string>(
  value: string | number | boolean | undefined,
  allowed: readonly T[],
): T | null {
  const text = toText(value);
  return text !== null && (allowed as readonly string[]).includes(text) ? (text as T) : null;
}

/** Inverted alias table, so the reading code names shell fields and never
 *  repeats the DSL spelling. A typo in either direction cannot silently read
 *  the wrong param. */
const SHELL_TO_DSL = Object.fromEntries(
  Object.entries(FIELD_ALIASES).map(([dsl, shell]) => [shell, dsl]),
) as Record<(typeof FIELD_ALIASES)[keyof typeof FIELD_ALIASES], keyof typeof FIELD_ALIASES>;

type Params = Record<string, string | number | boolean>;

function declared(params: Params, shell: keyof typeof SHELL_TO_DSL): string | number | boolean | undefined {
  return params[SHELL_TO_DSL[shell]];
}

/** Every experiment the model declares, in document order. */
export function readExperiments(document: Pick<ModelDocument, 'nodes'>): DeclaredExperiment[] {
  return document.nodes
    .filter((node) => node.kind === 'experiment')
    .map((node) => {
      const params = node.params;
      return {
        name: node.name,
        type: toText(params['type']),
        seed: toNumber(declared(params, 'seed')),
        seedMode: toEnum(declared(params, 'seedMode'), ['fixed', 'random'] as const),
        reps: toNumber(declared(params, 'reps')),
        replicationMode: toEnum(declared(params, 'replicationMode'), [
          'fixed',
          'precision',
        ] as const),
        minReps: toNumber(declared(params, 'minReps')),
        maxReps: toNumber(declared(params, 'maxReps')),
        errorPercent: toNumber(declared(params, 'errorPercent')),
        precisionMetric: toText(declared(params, 'precisionMetric')),
        confidence: toNumber(declared(params, 'confidence')),
      };
    });
}

/** A cheap identity for the model-owned half. The run dialog compares it
 *  against the last applied value so a re-parse (which happens on every
 *  keystroke) cannot overwrite what the user is typing: only a real change to
 *  the declaration re-applies it. */
export function experimentSignature(experiment: DeclaredExperiment | null): string {
  if (experiment === null) return '';
  return EXPERIMENT_OWNED_FIELDS.map((field) => `${field}=${String(experiment[field])}`).join(';');
}

/** Apply the model's declaration over the current run options. `null` means
 *  "the model did not say", so the current value stands; **no run-level field
 *  is written** — the experiment owns reproducibility and precision, the run
 *  owns warmup, termination, execution mode and speed.
 *
 *  The assignments below mirror `EXPERIMENT_OWNED_FIELDS` (which drives the
 *  signature function); `experiments.test.ts` pins the behaviour. */
export function applyExperimentFields(
  options: RunOptions,
  experiment: DeclaredExperiment,
): RunOptions {
  return {
    ...options,
    seed: experiment.seed ?? options.seed,
    seedMode: experiment.seedMode ?? options.seedMode,
    reps: experiment.reps ?? options.reps,
    replicationMode: experiment.replicationMode ?? options.replicationMode,
    minReps: experiment.minReps ?? options.minReps,
    maxReps: experiment.maxReps ?? options.maxReps,
    errorPercent: experiment.errorPercent ?? options.errorPercent,
    precisionMetric: experiment.precisionMetric ?? options.precisionMetric,
    confidence: experiment.confidence ?? options.confidence,
  };
}
