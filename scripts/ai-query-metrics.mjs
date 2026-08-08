// Grounded DES metric-query tool. It consumes an already completed run and
// reports only evidence present in metrics.json; it never regenerates or
// reruns a model behind the user's back.

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function queryMetrics({ question, metrics }) {
  if (!metrics || !Array.isArray(metrics.blocks)) {
    throw new Error('structured block metrics are required');
  }
  const blocks = metrics.blocks;
  const utilized = blocks
    .filter((block) => finite(block.utilization) > 0)
    .sort((a, b) => finite(b.utilization) - finite(a.utilization));
  const queued = blocks
    .filter((block) => block.kind === 'queue' || block.kind === 'wait')
    .sort((a, b) => finite(b.mean_occupancy) - finite(a.mean_occupancy));
  const timedOut = blocks
    .filter((block) => finite(block.timed_out_mean) > 0)
    .sort((a, b) => finite(b.timed_out_mean) - finite(a.timed_out_mean));
  const preempted = blocks
    .filter((block) => finite(block.preempted_mean) > 0)
    .sort((a, b) => finite(b.preempted_mean) - finite(a.preempted_mean));

  const findings = [];
  if (utilized[0]) {
    findings.push(
      `${utilized[0].name} has the highest measured utilization at ` +
      `${(finite(utilized[0].utilization) * 100).toFixed(1)}%.`,
    );
  }
  if (queued[0]) {
    findings.push(
      `${queued[0].name} has the largest mean queue occupancy at ` +
      `${finite(queued[0].mean_occupancy).toFixed(3)} agents.`,
    );
  }
  if (timedOut[0]) {
    findings.push(
      `${timedOut[0].name} records ${finite(timedOut[0].timed_out_mean).toFixed(1)} ` +
      'mean timed-out agents per replication.',
    );
  }
  if (preempted[0]) {
    findings.push(
      `${preempted[0].name} records ${finite(preempted[0].preempted_mean).toFixed(1)} ` +
      'mean preempted agents per replication.',
    );
  }
  if (findings.length === 0) {
    findings.push('The completed run contains no non-zero utilization, queue, timeout, or preemption evidence.');
  }

  return {
    kind: 'metric-query',
    question: String(question ?? '').trim() || 'What does this run show?',
    findings,
    evidence: {
      busiestBlock: utilized[0]?.name ?? null,
      busiestUtilization: utilized[0] ? finite(utilized[0].utilization) : null,
      largestQueue: queued[0]?.name ?? null,
      largestMeanOccupancy: queued[0] ? finite(queued[0].mean_occupancy) : null,
      blockCount: blocks.length,
    },
  };
}
