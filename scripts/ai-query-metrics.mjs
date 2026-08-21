// Grounded DES metric-query tool. It consumes an already completed run and
// reports only evidence present in metrics.json; it never regenerates or
// reruns a model behind the user's back.

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function queryMetrics({ question, metrics, model }) {
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
  const blockFindings = blocks
    .map((block) => ({
      name: String(block.name ?? 'unknown'),
      kind: String(block.kind ?? 'unknown'),
      utilization: finite(block.utilization),
      availability: finite(block.availability),
      meanOccupancy: finite(block.mean_occupancy),
      timedOut: finite(block.timed_out_mean),
      preempted: finite(block.preempted_mean),
    }))
    .sort(
      (a, b) =>
        b.utilization +
        b.meanOccupancy * 0.01 +
        b.timedOut * 0.01 -
        (a.utilization + a.meanOccupancy * 0.01 + a.timedOut * 0.01),
    )
    .slice(0, 5);
  const causalChain = buildCausalChain(model, utilized[0]?.name, queued[0]?.name);

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
  for (const block of blockFindings.slice(0, 3)) {
    const details = [];
    if (block.utilization > 0) details.push(`utilization ${(block.utilization * 100).toFixed(1)}%`);
    if (block.meanOccupancy > 0) details.push(`mean occupancy ${block.meanOccupancy.toFixed(3)}`);
    if (block.availability > 0 && block.availability < 1)
      details.push(`availability ${(block.availability * 100).toFixed(1)}%`);
    if (block.timedOut > 0) details.push(`timeouts ${block.timedOut.toFixed(1)}`);
    if (block.preempted > 0) details.push(`preemptions ${block.preempted.toFixed(1)}`);
    if (
      details.length > 0 &&
      !findings.some((finding) => finding.startsWith(`${block.name} has`))
    ) {
      findings.push(`${block.name} (${block.kind}): ${details.join(', ')}.`);
    }
  }
  if (findings.length === 0) {
    findings.push(
      'The completed run contains no non-zero utilization, queue, timeout, or preemption evidence.',
    );
  }
  if (causalChain.length > 1) {
    findings.push(`Topology evidence: ${causalChain.join(' → ')}.`);
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
      blockFindings,
      causalChain,
    },
  };
}

function buildCausalChain(model, bottleneckName, queueName) {
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) return [];
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const adjacency = new Map();
  for (const edge of model.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const list = adjacency.get(from.id) ?? [];
    list.push(to.id);
    adjacency.set(from.id, list);
  }
  const target = bottleneckName ?? queueName;
  if (!target) return [];
  const targetNode = model.nodes.find((node) => node.name === target);
  if (!targetNode) return [];
  const sources = model.nodes.filter((node) => node.kind === 'source');
  for (const source of sources) {
    const queue = [[source.id]];
    const seen = new Set([source.id]);
    while (queue.length > 0) {
      const path = queue.shift();
      const current = path.at(-1);
      if (current === targetNode.id) return path.map((id) => byId.get(id)?.name ?? id);
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [];
}
