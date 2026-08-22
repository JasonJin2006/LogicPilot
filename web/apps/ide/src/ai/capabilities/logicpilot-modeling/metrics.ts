import type { AssistantSessionState } from '../../assistantTypes';

export function summarizeMetrics(metrics: NonNullable<AssistantSessionState['runMetrics']>) {
  return {
    summary: metrics.summary ?? null,
    blocks: (metrics.blocks ?? []).map((block) => ({
      name: block.name,
      kind: block.kind,
      capacity: block.capacity,
      arrived_mean: block.arrived_mean,
      departed_mean: block.departed_mean,
      timed_out_mean: block.timed_out_mean,
      mean_occupancy: block.mean_occupancy,
      mean_wait: block.mean_wait,
      wait_count_mean: block.wait_count_mean,
      utilization: block.utilization,
      availability: block.availability,
    })),
  };
}
