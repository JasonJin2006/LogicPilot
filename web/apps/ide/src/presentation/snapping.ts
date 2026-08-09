export interface SnapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

type Anchor = { value: number };

function xAnchors(rect: SnapRect): Anchor[] {
  return [{ value: rect.x }, { value: rect.x + rect.width / 2 }, { value: rect.x + rect.width }];
}

function yAnchors(rect: SnapRect): Anchor[] {
  return [{ value: rect.y }, { value: rect.y + rect.height / 2 }, { value: rect.y + rect.height }];
}

/** Snap a moving rectangle's left/centre/right and top/middle/bottom anchors
 * to the closest peer anchor. The threshold is expressed in world units so
 * callers can keep the perceived snap distance stable at every zoom level. */
export function snapRect(moving: SnapRect, peers: SnapRect[], threshold = 6): SnapResult {
  let bestX: { delta: number; peer: SnapRect; value: number } | undefined;
  let bestY: { delta: number; peer: SnapRect; value: number } | undefined;

  for (const peer of peers) {
    for (const own of xAnchors(moving)) {
      for (const target of xAnchors(peer)) {
        const delta = target.value - own.value;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, peer, value: target.value };
        }
      }
    }
    for (const own of yAnchors(moving)) {
      for (const target of yAnchors(peer)) {
        const delta = target.value - own.value;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, peer, value: target.value };
        }
      }
    }
  }

  const x = moving.x + (bestX?.delta ?? 0);
  const y = moving.y + (bestY?.delta ?? 0);
  const snapped = { ...moving, x, y };
  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      axis: 'x',
      value: bestX.value,
      from: Math.min(snapped.y, bestX.peer.y) - 8,
      to: Math.max(snapped.y + snapped.height, bestX.peer.y + bestX.peer.height) + 8,
    });
  }
  if (bestY) {
    guides.push({
      axis: 'y',
      value: bestY.value,
      from: Math.min(snapped.x, bestY.peer.x) - 8,
      to: Math.max(snapped.x + snapped.width, bestY.peer.x + bestY.peer.width) + 8,
    });
  }
  return { x, y, guides };
}
