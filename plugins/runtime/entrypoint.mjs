// Single package-entrypoint source. The builder copies this into each package
// so installed packages remain self-contained without cross-package imports.
import { createHash } from 'node:crypto';

let kernel;
let target;
let runtimeKind;
export function activate(ctx) {
  if (ctx.manifest.executionTargets?.length !== 1)
    throw new Error('runtime needs exactly one target');
  target = ctx.manifest.executionTargets[0];
  runtimeKind = target.options?.paradigm;
  if (target.runtime.pluginId !== ctx.pluginId) throw new Error('runtime target owner mismatch');
  kernel = ctx.service('logicpilot.execution.kernel');
}
export function deactivate() {
  kernel = undefined;
}

export async function execute(request) {
  if (!kernel || request.targetId !== target.id)
    throw new Error('runtime is not active for target');
  const input = request.inputs;
  if (!input || input.paradigm !== runtimeKind || typeof input.dsl !== 'string')
    throw new Error('runtime input mismatch');
  if (
    request.seed !== undefined &&
    input.runParams?.seed !== undefined &&
    request.seed !== input.runParams.seed
  )
    throw new Error('conflicting execution seed');
  const result = await kernel.call({
    requestId: request.requestId,
    runtimeKind,
    dsl: input.dsl,
    runParams: {
      ...input.runParams,
      ...(request.seed === undefined ? {} : { seed: request.seed, seedMode: 'fixed' }),
    },
    budget: request.budget,
    replayCheck: runtimeKind === 'agent' || runtimeKind === 'devs',
  });
  const seed = result.experiment?.seed ?? request.seed;
  const run = {
    schema: 'logicpilot.execution-run/v1',
    contractVersion: 1,
    runId: request.runId ?? `run-${request.requestId}`,
    requestId: request.requestId,
    targetId: target.id,
    artifactRef: request.artifactRef ?? target.artifactRef,
    status: result.ok ? 'completed' : 'failed',
    ...(seed === undefined ? {} : { seed }),
    ...(result.ok ? {} : { error: `runtime failed: ${result.diagnostics?.[0]?.code ?? 'RT0005'}` }),
  };
  // Evidence method ids are open (ADR-0139): a paradigm the contract has never
  // heard of files evidence under its own name, so nothing is filtered against
  // a fixed list here. `sd` is the kernel's name for the continuous method and
  // is normalised; every other name passes through. Dropping an unrecognised
  // name would shrink the evidence silently, while the contract rejects a bad
  // payload loudly - the loud failure is the one worth keeping.
  const semanticMethods = [
    ...new Set(
      (Array.isArray(result.methods) ? result.methods : [runtimeKind]).map((method) =>
        method === 'sd' ? 'continuous' : method,
      ),
    ),
  ];
  const output = {
    ok: result.ok,
    diagnostics: result.diagnostics ?? [],
    runSummary: result.runSummary ?? '',
    metrics: result.metrics ?? null,
    trajectory: result.trajectory ?? null,
    verification: result.verification ?? null,
    experiment: result.experiment ?? null,
    methods: result.methods ?? [],
    ...(result.irDigest === undefined ? {} : { irDigest: result.irDigest }),
    ...(result.replayDeterministic === undefined
      ? {}
      : { replayDeterministic: result.replayDeterministic }),
  };
  if (!result.ok || result.metrics === null) return { run, output };
  const metrics = {};
  for (const [key, item] of Object.entries(result.metrics.summary ?? {})) {
    const value = typeof item === 'number' ? item : item?.mean;
    if (Number.isFinite(value)) metrics[key] = value;
  }
  const unsigned = {
    schema: 'logicpilot.execution-evidence/v1',
    contractVersion: 1,
    runId: run.runId,
    irDigest: result.irDigest,
    methods: semanticMethods,
    ...(runtimeKind === 'generic'
      ? {}
      : {
          runtimeKind,
          method: result.method,
          conformance: result.conformance,
          details: result.details,
        }),
    metrics,
  };
  return {
    run,
    evidence: {
      ...unsigned,
      digest: createHash('sha256').update(canonical(unsigned)).digest('hex'),
    },
    output,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
