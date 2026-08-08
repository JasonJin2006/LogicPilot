// Mutable visualization state shared between the frame handler (10 Hz wire
// frames) and the PixiJS render loop (requestAnimationFrame). Kept outside
// React state on purpose: interpolation runs at display rate and must not
// trigger React re-renders.

export interface VizAgent {
  /** Target position in world units (MM1: queue slot index / 0 at server). */
  x: number;
  y: number;
  /** MM1 mapping: state_bits bit 0 = customer currently in service. */
  serving: boolean;
}

/** Live per-block state for generic process-flow runs (10 Hz counters). */
export interface BlockLiveState {
  buffered: number;
  inService: number;
  arrived: number;
  departed: number;
}

export interface VizState {
  /** Latest Tick targets keyed by stable agent id (customer ordinal). */
  agents: Map<string, VizAgent>;
  /** Latest Counters.busy value (drives server highlight). */
  busy: boolean;
  /** Latest Counters.servers (service-cell count). */
  servers: number;
  /** Latest Counters.down_servers (cells tinted red while down). */
  downServers: number;
  /** Latest Counters.queue_length (live queue badge on the canvas). */
  queueLength: number;
  /** Latest Counters.throughput (agents served, for bindings). */
  throughput: number;
  /** Latest Counters.mean_wait (mean waiting time, for bindings). */
  meanWait: number;
  /** Latest per-block live state keyed by block name (generic flows). */
  blocks: Map<string, BlockLiveState>;
  /** Bumped on every applied Tick so the renderer can detect new data. */
  tickVersion: number;
}

export function createVizState(): VizState {
  return {
    agents: new Map(),
    busy: false,
    servers: 1,
    downServers: 0,
    queueLength: 0,
    throughput: 0,
    meanWait: 0,
    blocks: new Map(),
    tickVersion: 0,
  };
}

export function resetVizState(viz: VizState): void {
  viz.agents = new Map();
  viz.busy = false;
  viz.servers = 1;
  viz.downServers = 0;
  viz.queueLength = 0;
  viz.throughput = 0;
  viz.meanWait = 0;
  viz.blocks = new Map();
  viz.tickVersion += 1;
}

/** Parse generic process-flow counters (`block.<name>.<field>`) into the
 *  per-block live state map. Non-block counters are ignored. */
export function parseBlockCounters(
  values: Record<string, number>,
): Map<string, BlockLiveState> {
  const blocks = new Map<string, BlockLiveState>();
  for (const [key, value] of Object.entries(values)) {
    const match = /^block\.(.+)\.(buffered|in_service|arrived|departed)$/.exec(key);
    if (!match) continue;
    const name = match[1]!;
    const field = match[2]!;
    let entry = blocks.get(name);
    if (!entry) {
      entry = { buffered: 0, inService: 0, arrived: 0, departed: 0 };
      blocks.set(name, entry);
    }
    if (field === 'buffered') entry.buffered = Math.max(0, Math.round(value));
    else if (field === 'in_service') entry.inService = Math.max(0, Math.round(value));
    else if (field === 'arrived') entry.arrived = Math.max(0, Math.round(value));
    else entry.departed = Math.max(0, Math.round(value));
  }
  return blocks;
}

// Module-level singleton shared by the frame handler (10 Hz wire frames)
// and the PixiJS render loop (requestAnimationFrame). Kept outside React
// state on purpose: interpolation runs at display rate and must not trigger
// React re-renders.
export const vizState = createVizState();
