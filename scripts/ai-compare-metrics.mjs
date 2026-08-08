// Compare two completed DES runs using their structured block statistics.
// Matching is semantic (kind + name); added/removed blocks remain explicit.

const METRICS = [
  'departed_mean',
  'mean_occupancy',
  'utilization',
  'timed_out_mean',
  'preempted_mean',
];

const REPLICATION_METRICS = ['throughput', 'L', 'Lq', 'W', 'Wq', 'utilization', 'availability'];
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

// Acklam inverse-normal approximation, matching the native replication
// summary closely enough for non-95% experiment levels.
function inverseNormal(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 0.97575) return -inverseNormal(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function studentCritical(confidence, degreesOfFreedom) {
  const t95 = degreesOfFreedom <= 30
    ? T_95[degreesOfFreedom - 1]
    : 1.96 + 1 / degreesOfFreedom;
  return confidence === 0.95
    ? t95
    : t95 * (inverseNormal(0.5 + confidence / 2) / 1.959964);
}

function pairedStatistics(before, after, confidence) {
  if (!Array.isArray(before.replications) || !Array.isArray(after.replications)) return [];
  const beforeByPair = new Map(before.replications.map((rep) => [`${rep.rep}:${rep.seed}`, rep]));
  const pairs = after.replications
    .map((rep) => [beforeByPair.get(`${rep.rep}:${rep.seed}`), rep])
    .filter(([previous]) => previous != null);
  if (pairs.length < 2) return [];
  return REPLICATION_METRICS.map((metric) => {
    const differences = pairs.map(([previous, current]) => finite(current[metric]) - finite(previous[metric]));
    const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (differences.length - 1);
    const halfWidth = studentCritical(confidence, differences.length - 1) *
      Math.sqrt(variance / differences.length);
    const ciLow = mean - halfWidth;
    const ciHigh = mean + halfWidth;
    return {
      metric,
      samples: differences.length,
      confidence,
      meanDifference: mean,
      ciLow,
      ciHigh,
      conclusion: ciLow > 0 ? 'increase' : ciHigh < 0 ? 'decrease' : 'inconclusive',
    };
  });
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function blockKey(block) {
  return `${block.kind}:${block.name}`;
}

function largestQueue(metrics) {
  return metrics.blocks
    .filter((block) => block.kind === 'queue' || block.kind === 'wait')
    .sort((a, b) => finite(b.mean_occupancy) - finite(a.mean_occupancy))[0] ?? null;
}

function sinkDepartures(metrics) {
  return metrics.blocks
    .filter((block) => block.kind === 'sink')
    .reduce((sum, block) => sum + finite(block.departed_mean), 0);
}

export function compareMetrics({ before, after, confidence = 0.95 }) {
  if (!Array.isArray(before?.blocks) || !Array.isArray(after?.blocks)) {
    throw new Error('before and after structured block metrics are required');
  }
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  const beforeByKey = new Map(before.blocks.map((block) => [blockKey(block), block]));
  const afterByKey = new Map(after.blocks.map((block) => [blockKey(block), block]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const blocks = [...keys].sort().map((key) => {
    const previous = beforeByKey.get(key) ?? null;
    const current = afterByKey.get(key) ?? null;
    const values = {};
    for (const metric of METRICS) {
      const beforeValue = previous ? finite(previous[metric]) : 0;
      const afterValue = current ? finite(current[metric]) : 0;
      values[metric] = {
        before: beforeValue,
        after: afterValue,
        delta: afterValue - beforeValue,
      };
    }
    return {
      key,
      name: current?.name ?? previous?.name,
      kind: current?.kind ?? previous?.kind,
      status: previous && current ? 'matched' : current ? 'added' : 'removed',
      metrics: values,
    };
  });

  const beforeQueue = largestQueue(before);
  const afterQueue = largestQueue(after);
  const beforeThroughput = sinkDepartures(before);
  const afterThroughput = sinkDepartures(after);
  const findings = [];
  if (beforeQueue && afterQueue) {
    const delta = finite(afterQueue.mean_occupancy) - finite(beforeQueue.mean_occupancy);
    findings.push(
      `Largest mean queue occupancy changed from ${finite(beforeQueue.mean_occupancy).toFixed(3)} ` +
      `(${beforeQueue.name}) to ${finite(afterQueue.mean_occupancy).toFixed(3)} ` +
      `(${afterQueue.name}), delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}.`,
    );
  }
  const throughputDelta = afterThroughput - beforeThroughput;
  findings.push(
    `Total sink departures per replication changed from ${beforeThroughput.toFixed(1)} to ` +
    `${afterThroughput.toFixed(1)}, delta ${throughputDelta >= 0 ? '+' : ''}${throughputDelta.toFixed(1)}.`,
  );

  const statistical = pairedStatistics(before, after, confidence);
  for (const metric of statistical.filter((entry) => ['throughput', 'Lq', 'Wq'].includes(entry.metric))) {
    const interval = `[${metric.ciLow.toFixed(4)}, ${metric.ciHigh.toFixed(4)}]`;
    if (metric.conclusion === 'inconclusive') {
      findings.push(
        `${metric.metric} change is inconclusive at ${(confidence * 100).toFixed(0)}% confidence ` +
        `(paired mean delta ${metric.meanDifference.toFixed(4)}, CI ${interval}, n=${metric.samples}).`,
      );
    } else {
      findings.push(
        `${metric.metric} shows a statistically supported ${metric.conclusion} at ` +
        `${(confidence * 100).toFixed(0)}% confidence (paired mean delta ` +
        `${metric.meanDifference.toFixed(4)}, CI ${interval}, n=${metric.samples}).`,
      );
    }
  }
  const timeoutBefore = before.blocks.reduce((sum, block) => sum + finite(block.timed_out_mean), 0);
  const timeoutAfter = after.blocks.reduce((sum, block) => sum + finite(block.timed_out_mean), 0);
  const timeoutDelta = timeoutAfter - timeoutBefore;
  findings.push(
    `Total mean timeouts changed from ${timeoutBefore.toFixed(1)} to ${timeoutAfter.toFixed(1)}, ` +
    `delta ${timeoutDelta >= 0 ? '+' : ''}${timeoutDelta.toFixed(1)}.`,
  );

  return {
    kind: 'metric-comparison',
    findings,
    summary: {
      sinkDeparturesBefore: beforeThroughput,
      sinkDeparturesAfter: afterThroughput,
      sinkDeparturesDelta: throughputDelta,
      timeoutsBefore: timeoutBefore,
      timeoutsAfter: timeoutAfter,
      timeoutsDelta: timeoutDelta,
    },
    blocks,
    statistical,
  };
}
