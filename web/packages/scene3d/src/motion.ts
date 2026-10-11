// Live simulation -> 3D motion.
//
// The wire frames describe agents as scalars, not positions: `posX` is a queue
// slot index (0 = at the server) and `posY` is reserved. Nothing in the IDE
// consumed them before this view, so the mapping from slot index to a place in
// the scene is defined here, once, and tested.
//
// The rule, stated so it stays a decision rather than an accident:
//
//   * The flow axis runs from the *service* block toward the *queue* block, so
//     slot 0 sits at the server and higher slots queue away from it.
//   * A waiting agent sits on that axis at `slot * spacing`, clamped to
//     `AGENT_MAX_QUEUE_SPAN` — a queue of 200 must not stretch the scene to the
//     horizon, and a clamped pile still reads as "very long queue".
//   * An agent in service sits at the service block, spread across the declared
//     server cells perpendicular to the axis.
//
// Agents are only placed when the model actually has a queue block and a
// service block. Without both there is no axis, and inventing one would put
// agents in a position that means nothing.

import {
  addVec3,
  crossVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  vec3,
  type Vec3,
} from './math3d.js';

/** Gap between neighbouring waiting agents, in world units. */
export const AGENT_SPACING = 1.15;
/** How far the queue is allowed to stretch before agents start sharing slots. */
export const AGENT_MAX_QUEUE_SPAN = 16;
/** Radius of the agent marker, so the renderer and the tests agree on scale.
 *
 * Sized against `NODE_FOOTPRINT` (3.2) rather than picked freely: a marker much
 * under a fifth of a block reads as a speck and defeats the point of watching a
 * run, which is seeing who is queued and who is being served. */
export const AGENT_RADIUS = 0.62;
/** Height above the block plane, so agents read as objects on the floor. */
export const AGENT_ELEVATION = 1.2;

const WORLD_UP = vec3(0, 1, 0);

/** The block kinds the agent layer anchors to.
 *
 * Only a model with both can show agents: without a queue and a service block
 * there is no flow axis, and placing agents anyway would put them somewhere that
 * means nothing. */
const QUEUE_KINDS: readonly string[] = ['queue', 'collection'];
const SERVICE_KINDS: readonly string[] = ['service', 'action'];

export interface FlowAnchors {
  /** World position of the queue block. */
  queue: Vec3;
  /** World position of the service block. */
  service: Vec3;
  /** Number of service cells (Counters.servers), at least 1. */
  servers: number;
}

export interface AgentView {
  id: string;
  /** Queue slot index; 0 means "at the server". */
  slot: number;
  serving: boolean;
}

export interface AgentPlacement {
  id: string;
  position: Vec3;
  serving: boolean;
}

export interface FlowFrame {
  origin: Vec3;
  /** Unit vector from the server toward the queue. */
  direction: Vec3;
  /** Unit vector perpendicular to `direction`, for spreading server cells. */
  side: Vec3;
}

/**
 * Derives the flow anchors from the scene, or null when the model has no
 * queue/service pair to anchor to.
 *
 * `servers` comes from the run's counters rather than from the model, because
 * the model can change capacity at runtime; the caller passes what the wire
 * frames reported.
 */
export function flowAnchorsFromScene(
  objects: readonly { kind: string; position: Vec3 }[],
  servers: number,
): FlowAnchors | null {
  const queue = objects.find((object) => QUEUE_KINDS.includes(object.kind));
  const service = objects.find((object) => SERVICE_KINDS.includes(object.kind));
  if (queue === undefined || service === undefined) return null;
  return {
    queue: queue.position,
    service: service.position,
    servers: Number.isFinite(servers) ? Math.max(1, Math.round(servers)) : 1,
  };
}

/** The scene-space axis the flow runs along, or null when it is degenerate
 *  (the queue and the service block are at the same place, or no direction). */
export function flowFrame(anchors: FlowAnchors): FlowFrame | null {
  const raw = subVec3(anchors.queue, anchors.service);
  const flat = vec3(raw.x, 0, raw.z);
  const direction = normalizeVec3(flat);
  if (direction === null) return null;
  const side = normalizeVec3(crossVec3(direction, WORLD_UP));
  if (side === null) return null;
  return {
    origin: vec3(anchors.service.x, anchors.service.y + AGENT_ELEVATION, anchors.service.z),
    direction,
    side,
  };
}

/** Places every agent for one wire frame.
 *
 * Ordering is by slot then id, so the result is deterministic for a given frame
 * and a test can assert exact positions. */
export function placeAgents(agents: readonly AgentView[], anchors: FlowAnchors): AgentPlacement[] {
  const frame = flowFrame(anchors);
  if (frame === null) return [];
  const serverCells = Math.max(1, Math.round(anchors.servers));
  const ordered = [...agents].sort((a, b) => {
    if (a.serving !== b.serving) return a.serving ? -1 : 1;
    if (a.slot !== b.slot) return a.slot - b.slot;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let serviceIndex = 0;
  return ordered.map((agent) => {
    if (agent.serving) {
      // Spread the in-service agents around the service block so several cells
      // are visible at once instead of stacking on one point.
      const offset = (serviceIndex - (serverCells - 1) / 2) * (AGENT_RADIUS * 2.6);
      serviceIndex += 1;
      return {
        id: agent.id,
        serving: true,
        position: addVec3(frame.origin, scaleVec3(frame.side, offset)),
      };
    }
    const slot = Number.isFinite(agent.slot) ? Math.max(0, agent.slot) : 0;
    const distance = Math.min((slot + 1) * AGENT_SPACING, AGENT_MAX_QUEUE_SPAN);
    return {
      id: agent.id,
      serving: false,
      position: addVec3(frame.origin, scaleVec3(frame.direction, distance)),
    };
  });
}

/** Per-agent rendered positions, interpolated toward the latest targets.
 *
 * Wire frames arrive at ~10 Hz while the scene draws at display rate, so agents
 * would visibly step without this. The smoothing is exponential and driven by
 * the elapsed seconds rather than by a per-frame constant, which keeps the
 * motion identical at 30 and 144 fps — and makes it testable with a fixed dt.
 */
export class AgentMotion {
  private positions = new Map<string, Vec3>();

  /** Advances toward `placements`. Returns true when anything moved, which the
   *  host uses to decide whether to redraw. */
  advance(placements: readonly AgentPlacement[], deltaSeconds: number, smoothing = 12): boolean {
    const safeDelta = Number.isFinite(deltaSeconds) ? Math.min(Math.max(deltaSeconds, 0), 0.1) : 0;
    // Frame-rate independent exponential approach.
    const blend = Math.min(1, 1 - Math.exp(-Math.max(0, smoothing) * safeDelta));
    const seen = new Set<string>();
    let moved = false;

    for (const placement of placements) {
      seen.add(placement.id);
      const current = this.positions.get(placement.id);
      if (current === undefined) {
        // A new agent appears where it belongs rather than sliding in from the
        // origin, which would draw a line of agents streaming out of nowhere.
        this.positions.set(placement.id, placement.position);
        moved = true;
        continue;
      }
      const next = {
        x: current.x + (placement.position.x - current.x) * blend,
        y: current.y + (placement.position.y - current.y) * blend,
        z: current.z + (placement.position.z - current.z) * blend,
      };
      if (Math.abs(next.x - current.x) > 1e-4 || Math.abs(next.z - current.z) > 1e-4) {
        moved = true;
      }
      this.positions.set(placement.id, next);
    }

    for (const id of [...this.positions.keys()]) {
      if (seen.has(id)) continue;
      this.positions.delete(id);
      moved = true;
    }

    return moved;
  }

  /** Snaps straight to the targets, for a new run or a fresh connection. */
  reset(placements: readonly AgentPlacement[] = []): void {
    this.positions.clear();
    for (const placement of placements) {
      this.positions.set(placement.id, placement.position);
    }
  }

  positionOf(id: string): Vec3 | undefined {
    return this.positions.get(id);
  }

  entries(): Array<[string, Vec3]> {
    return [...this.positions.entries()];
  }

  size(): number {
    return this.positions.size;
  }
}
