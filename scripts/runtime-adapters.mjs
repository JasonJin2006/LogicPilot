// Runtime policy around the shared DSL -> verified IR -> kernel dispatcher.
// The kernel's method summary is authoritative; source keywords are not.
import { normalizeRunParams, runModelDsl } from './ai-build.mjs';
import { assessRuntimeResult, replayMatches } from './runtime-conformance.mjs';

const METHODS = Object.freeze({
  process: 'process',
  devs: 'devs',
  continuous: 'sd',
  agent: 'agent',
});

export async function runRuntimeModel({ runtimeKind, dsl, replayCheck = false, ...options }) {
  if (!Object.hasOwn(METHODS, runtimeKind)) throw new Error('unknown runtime adapter');
  if (typeof dsl !== 'string' || dsl.length === 0)
    return failed('RT0002', 'model source is required');
  if (options.signal?.aborted)
    return failed('RT0005', 'runtime execution was cancelled before it started');
  const started = Date.now();
  const wallMs = options.budget?.maxWallMs;
  const remainingBudget = () => {
    if (wallMs === undefined) return options.budget;
    const remaining = wallMs - (Date.now() - started);
    if (!Number.isSafeInteger(wallMs) || remaining <= 0)
      throw new Error('execution deadline exceeded');
    return { ...options.budget, maxWallMs: remaining };
  };
  try {
    // A family may choose a default, but must preserve an explicit count.
    // Logical ticks and independent replications are different quantities.
    const runParams = normalizeRunParams({
      ...(runtimeKind === 'process' ? {} : { reps: 1 }),
      ...options.runParams,
    });
    if (options.budget?.maxSteps !== undefined) {
      const limit = options.budget.maxSteps;
      if (!Number.isSafeInteger(limit) || limit < 1) return failed('RT0003', 'invalid step budget');
      if (!['agent', 'devs'].includes(runtimeKind))
        return failed('RT0003', 'step budget is not supported by this runtime adapter');
      if (runParams.arrivals > limit) return failed('RT0003', 'requested steps exceed budget');
    }
    let result = await runModelDsl({
      ...options,
      dsl,
      runParams,
      runtimeKind,
      budget: remainingBudget(),
    });
    if (!result.ok) return result;
    if (replayCheck) {
      // Freeze effective seed/count even for random-seed or adaptive runs.
      const replay = await runModelDsl({
        ...options,
        dsl,
        runParams: result.experiment,
        runtimeKind,
        budget: remainingBudget(),
      });
      result = { ...result, replayDeterministic: replayMatches(result, replay) };
    }
    const assessed = assessRuntimeResult(runtimeKind, result);
    return {
      ...result,
      ok: assessed.conformance.passed,
      runtimeKind,
      method: METHODS[runtimeKind],
      ...assessed,
      diagnostics: assessed.conformance.passed
        ? []
        : [{ code: 'RT0004', severity: 'error', message: 'runtime evidence failed validation' }],
    };
  } catch {
    return failed('RT0005', 'runtime execution failed or exceeded its deadline');
  }
}

export function runtimeAdapterIds() {
  return Object.keys(METHODS);
}

function failed(code, message) {
  return {
    ok: false,
    diagnostics: [{ code, severity: 'error', message }],
    runSummary: '',
    metrics: null,
    trajectory: null,
    verification: null,
  };
}
