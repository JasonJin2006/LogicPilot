// Structural evidence validation. Scientific reference-model assertions belong
// in conformance suites, not in heuristics based on variable names.
export function assessRuntimeResult(kind, result) {
  const reps = result.metrics?.replications;
  const checks = {
    replicationsPresent: Array.isArray(reps) && reps.length > 0,
    finiteMetrics: finiteNumbers(result.metrics),
  };
  const summary = { replications: Array.isArray(reps) ? reps.length : 0 };
  if (kind === 'process') {
    checks.utilizationValid =
      Number.isFinite(result.metrics?.summary?.utilization?.mean) &&
      result.metrics.summary.utilization.mean >= 0 &&
      result.metrics.summary.utilization.mean <= 1;
    Object.assign(summary, {
      throughputMean: result.metrics?.summary?.throughput?.mean ?? null,
      utilizationMean: result.metrics?.summary?.utilization?.mean ?? null,
      queueWaitMean: result.metrics?.summary?.Wq?.mean ?? null,
    });
  } else if (kind === 'continuous') {
    const points = result.trajectory?.points;
    checks.trajectoryValid =
      Array.isArray(points) &&
      points.length > 0 &&
      points.every(
        (point, index) =>
          Number.isFinite(point.t) &&
          Array.isArray(point.values) &&
          point.values.length > 0 &&
          point.values.every((value) => typeof value === 'number' && Number.isFinite(value)) &&
          (index === 0 || point.t >= points[index - 1].t),
      );
    Object.assign(summary, {
      trajectoryPoints: points?.length ?? 0,
      variables: result.trajectory?.variables ?? [],
      finalValues: points?.at(-1)?.values ?? [],
    });
  } else {
    checks.driverStepsValid =
      Array.isArray(reps) &&
      reps.every((rep) => Number.isSafeInteger(rep.arrivals) && rep.arrivals >= 0);
    Object.assign(summary, {
      driverSteps: reps?.[0]?.arrivals ?? null,
      horizonSeconds: reps?.[0]?.horizon_seconds ?? null,
    });
    if (kind === 'agent' && result.logicalTraceBytes > 0) {
      checks.logicalTraceValid =
        /^[a-f0-9]{64}$/.test(result.logicalTraceDigest ?? '') &&
        Number.isSafeInteger(result.logicalTraceSteps) &&
        result.logicalTraceSteps > 0;
      Object.assign(summary, {
        logicalTraceSteps: result.logicalTraceSteps,
        logicalTraceBytes: result.logicalTraceBytes,
        logicalTraceDigest: result.logicalTraceDigest,
      });
    } else {
      // LPLT's empty 24-byte header cannot prove any DEVS transition.
      summary.traceStatus = kind === 'devs' ? 'transition-trace-not-exported' : 'not-requested';
    }
  }
  if (result.replayDeterministic !== undefined) {
    checks.replayDeterministic = result.replayDeterministic === true;
    summary.replayDeterministic = checks.replayDeterministic;
  }
  return {
    conformance: { passed: Object.values(checks).every((value) => value === true), checks },
    details: { kind, summary },
  };
}

function finiteNumbers(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value !== 'object') return true;
  return Object.values(value).every(finiteNumbers);
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

export function replayMatches(first, second) {
  return (
    second.ok === true &&
    canonical(first.methods) === canonical(second.methods) &&
    canonical(first.metrics) === canonical(second.metrics) &&
    canonical(first.trajectory) === canonical(second.trajectory) &&
    first.logicalTraceDigest === second.logicalTraceDigest
  );
}
