import { describe, expect, it } from 'vitest';
import {
  AGENT_ELEVATION,
  flowAnchorsFromScene,
  AGENT_MAX_QUEUE_SPAN,
  AGENT_SPACING,
  AgentMotion,
  flowFrame,
  placeAgents,
  type FlowAnchors,
} from '../src/motion';
import { vec3 } from '../src/math3d';

// The service block sits at the origin and the queue lies along +x, so the
// expected positions are easy to read.
const anchors: FlowAnchors = { queue: vec3(20, 0, 0), service: vec3(0, 0, 0), servers: 2 };

describe('flow axis', () => {
  it('points from the server toward the queue and lifts to block height', () => {
    const frame = flowFrame(anchors);
    expect(frame).not.toBeNull();
    if (frame === null) return;
    expect(frame.direction.x).toBeCloseTo(1, 9);
    expect(frame.direction.z).toBeCloseTo(0, 9);
    expect(frame.origin.y).toBeCloseTo(AGENT_ELEVATION, 9);
  });

  it('declines when the two anchors coincide instead of inventing a direction', () => {
    // No axis means agents cannot be placed meaningfully; the caller must then
    // leave the agent layer off rather than stack everything on one point.
    expect(flowFrame({ queue: vec3(0, 0, 0), service: vec3(0, 0, 0), servers: 1 })).toBeNull();
  });

  it('ignores vertical separation between the anchors', () => {
    // Blocks can sit at different container depths; the flow is horizontal.
    const frame = flowFrame({ queue: vec3(10, 5, 0), service: vec3(0, 5, 0), servers: 1 });
    expect(frame).not.toBeNull();
    if (frame === null) return;
    expect(frame.direction.y).toBeCloseTo(0, 9);
  });
});

describe('agent placement', () => {
  it('puts slot 0 next to the server and higher slots further back', () => {
    const placements = placeAgents(
      [
        { id: 'b', slot: 2, serving: false },
        { id: 'a', slot: 1, serving: false },
      ],
      anchors,
    );
    const byId = new Map(placements.map((entry) => [entry.id, entry.position]));
    expect(byId.get('a')?.x).toBeCloseTo(2 * AGENT_SPACING, 9);
    expect(byId.get('b')?.x).toBeCloseTo(3 * AGENT_SPACING, 9);
  });

  it('is deterministic regardless of input order', () => {
    const forward = placeAgents(
      [
        { id: 'a', slot: 1, serving: false },
        { id: 'b', slot: 2, serving: false },
      ],
      anchors,
    );
    const reversed = placeAgents(
      [
        { id: 'b', slot: 2, serving: false },
        { id: 'a', slot: 1, serving: false },
      ],
      anchors,
    );
    expect(reversed).toEqual(forward);
  });

  it('clamps a long queue instead of stretching the scene', () => {
    const placements = placeAgents([{ id: 'far', slot: 500, serving: false }], anchors);
    expect(placements[0]?.position.x).toBeCloseTo(AGENT_MAX_QUEUE_SPAN, 6);
  });

  it('spreads agents in service across the declared cells', () => {
    const placements = placeAgents(
      [
        { id: 'a', slot: 0, serving: true },
        { id: 'b', slot: 0, serving: true },
      ],
      { ...anchors, servers: 2 },
    );
    expect(placements).toHaveLength(2);
    const first = placements[0];
    const second = placements[1];
    expect(first?.position.y).toBeCloseTo(second?.position.y ?? 0, 9);
    expect(first?.position.z).not.toBeCloseTo(second?.position.z ?? 0, 6);
  });

  it('keeps serving agents at the server and waiting agents away from it', () => {
    const placements = placeAgents(
      [
        { id: 'served', slot: 3, serving: true },
        { id: 'waiting', slot: 3, serving: false },
      ],
      anchors,
    );
    const served = placements.find((entry) => entry.id === 'served');
    const waiting = placements.find((entry) => entry.id === 'waiting');
    expect(served?.position.x).toBeCloseTo(0, 6);
    expect(waiting?.position.x).toBeCloseTo(4 * AGENT_SPACING, 9);
  });

  it('treats a negative or non-finite slot as the front of the queue', () => {
    const placements = placeAgents(
      [
        { id: 'neg', slot: -5, serving: false },
        { id: 'nan', slot: Number.NaN, serving: false },
      ],
      anchors,
    );
    for (const entry of placements) {
      expect(entry.position.x).toBeCloseTo(AGENT_SPACING, 9);
    }
  });

  it('produces nothing when there is no flow axis', () => {
    const placements = placeAgents([{ id: 'a', slot: 1, serving: false }], {
      queue: vec3(0, 0, 0),
      service: vec3(0, 0, 0),
      servers: 1,
    });
    expect(placements).toEqual([]);
  });
});

describe('anchors from the scene', () => {
  const objects = [
    { kind: 'source', position: vec3(0, 0, 0) },
    { kind: 'queue', position: vec3(6, 0, 0) },
    { kind: 'service', position: vec3(12, 0, 0) },
  ];

  it('finds the queue and service blocks', () => {
    const anchorsFromScene = flowAnchorsFromScene(objects, 3);
    expect(anchorsFromScene).not.toBeNull();
    if (anchorsFromScene === null) return;
    expect(anchorsFromScene.queue.x).toBeCloseTo(6, 9);
    expect(anchorsFromScene.service.x).toBeCloseTo(12, 9);
    expect(anchorsFromScene.servers).toBe(3);
  });

  it('returns null when the model has no place to put agents', () => {
    // Half a pair is not a flow: better to draw no agents than to guess an axis.
    expect(flowAnchorsFromScene([{ kind: 'queue', position: vec3(1, 0, 0) }], 1)).toBeNull();
    expect(flowAnchorsFromScene([{ kind: 'service', position: vec3(1, 0, 0) }], 1)).toBeNull();
    expect(flowAnchorsFromScene([], 1)).toBeNull();
  });

  it('keeps at least one server cell for a nonsense counter', () => {
    const zero = flowAnchorsFromScene(objects, 0);
    expect(zero?.servers).toBe(1);
    const nan = flowAnchorsFromScene(objects, Number.NaN);
    expect(nan?.servers).toBe(1);
  });
});

describe('motion interpolation', () => {
  it('starts a new agent at its target rather than sliding it in from nowhere', () => {
    const motion = new AgentMotion();
    motion.advance([{ id: 'a', position: vec3(10, 0, 0), serving: false }], 0.016);
    expect(motion.positionOf('a')?.x).toBeCloseTo(10, 9);
  });

  it('approaches the target over successive frames', () => {
    const motion = new AgentMotion();
    motion.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.016);
    motion.advance([{ id: 'a', position: vec3(9, 0, 0), serving: false }], 0.016);
    const afterOne = motion.positionOf('a')?.x ?? 0;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(9);
    for (let index = 0; index < 120; index += 1) {
      motion.advance([{ id: 'a', position: vec3(9, 0, 0), serving: false }], 0.016);
    }
    expect(motion.positionOf('a')?.x).toBeCloseTo(9, 3);
  });

  it('is frame-rate independent for the same elapsed time', () => {
    const fast = new AgentMotion();
    const slow = new AgentMotion();
    fast.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.1);
    slow.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.1);
    // 10 frames of 10ms against 2 frames of 50ms: the same elapsed time must
    // land the agent in the same place.
    for (let index = 0; index < 10; index += 1) {
      fast.advance([{ id: 'a', position: vec3(10, 0, 0), serving: false }], 0.01);
    }
    for (let index = 0; index < 2; index += 1) {
      slow.advance([{ id: 'a', position: vec3(10, 0, 0), serving: false }], 0.05);
    }
    expect(fast.positionOf('a')?.x).toBeCloseTo(slow.positionOf('a')?.x ?? -1, 6);
  });

  it('drops agents that leave the frame', () => {
    const motion = new AgentMotion();
    motion.advance(
      [
        { id: 'a', position: vec3(0, 0, 0), serving: false },
        { id: 'b', position: vec3(1, 0, 0), serving: false },
      ],
      0.016,
    );
    motion.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.016);
    expect(motion.size()).toBe(1);
    expect(motion.positionOf('b')).toBeUndefined();
  });

  it('reports whether anything moved so the host can skip redraws', () => {
    const motion = new AgentMotion();
    expect(motion.advance([{ id: 'a', position: vec3(2, 0, 0), serving: false }], 0.016)).toBe(
      true,
    );
    // Already settled on the target: nothing to redraw.
    expect(motion.advance([{ id: 'a', position: vec3(2, 0, 0), serving: false }], 0.016)).toBe(
      false,
    );
    expect(motion.advance([{ id: 'a', position: vec3(6, 0, 0), serving: false }], 0.016)).toBe(
      true,
    );
  });

  it('clamps a huge delta so a stalled tab cannot teleport agents', () => {
    const motion = new AgentMotion();
    motion.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.016);
    // A 30-second stall must not become a 30-second jump.
    motion.advance([{ id: 'a', position: vec3(100, 0, 0), serving: false }], 30);
    const moved = motion.positionOf('a')?.x ?? 0;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(100);
  });

  it('snaps on reset', () => {
    const motion = new AgentMotion();
    motion.advance([{ id: 'a', position: vec3(0, 0, 0), serving: false }], 0.016);
    motion.reset([{ id: 'a', position: vec3(7, 0, 0), serving: false }]);
    expect(motion.positionOf('a')?.x).toBeCloseTo(7, 9);
    motion.reset();
    expect(motion.size()).toBe(0);
  });
});
