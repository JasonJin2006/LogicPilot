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
    tickVersion: 0,
  };
}

export function resetVizState(viz: VizState): void {
  viz.agents = new Map();
  viz.busy = false;
  viz.servers = 1;
  viz.downServers = 0;
  viz.queueLength = 0;
  viz.tickVersion += 1;
}

// Module-level singleton shared by the frame handler (10 Hz wire frames)
// and the PixiJS render loop (requestAnimationFrame). Kept outside React
// state on purpose: interpolation runs at display rate and must not trigger
// React re-renders.
export const vizState = createVizState();
