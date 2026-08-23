// Orthogonal (Manhattan) edge routing for the SysML projection canvas.
//
// Cross-container relations previously rendered as straight diagonals that
// cut through container frames. This router computes a deterministic
// L/Z-shaped polyline between two element rectangles at RENDER time, so it
// holds for every layout backend (ELK layered, tidy-tree first paint) and
// keeps following nodes across manual drags without any persisted geometry
// (plan §13: 图形布局与语义分离).
//
// Policy (documented, deterministic):
//   - horizontal separation wins: exit/enter on the facing sides with one
//     vertical channel segment halfway between them (H-V-H);
//   - purely vertical separation routes V-H-V through a horizontal channel;
//   - overlapping boxes (both axes) escape around the right side - rare,
//     deterministic, and never intersects either rectangle's interior.

export interface RouteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutePoint {
  x: number;
  y: number;
}

const CHANNEL_GAP = 48;

const point = (x: number, y: number): RoutePoint => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });

/** Deterministic Manhattan polyline from rectangle `a` to rectangle `b`.
 *  The first/last points sit ON the facing borders so arrowheads touch. */
export function orthogonalRoute(a: RouteRect, b: RouteRect): RoutePoint[] {
  const aMidY = a.y + a.height / 2;
  const bMidY = b.y + b.height / 2;
  const aRightX = a.x + a.width;
  const bRightX = b.x + b.width;

  // b entirely right of a: leave a on its right border, enter b on its left.
  if (b.x >= aRightX) {
    if (Math.abs(aMidY - bMidY) < 0.5) {
      return [point(aRightX, aMidY), point(b.x, bMidY)];
    }
    const channelX = (aRightX + b.x) / 2;
    return [
      point(aRightX, aMidY),
      point(channelX, aMidY),
      point(channelX, bMidY),
      point(b.x, bMidY),
    ];
  }
  // Mirror: b entirely left of a.
  if (bRightX <= a.x) {
    if (Math.abs(aMidY - bMidY) < 0.5) {
      return [point(a.x, aMidY), point(bRightX, bMidY)];
    }
    const channelX = (a.x + bRightX) / 2;
    return [
      point(a.x, aMidY),
      point(channelX, aMidY),
      point(channelX, bMidY),
      point(bRightX, bMidY),
    ];
  }

  // Vertical separation: leave a through its bottom (or top) border, enter
  // b through its top (or bottom), with one horizontal channel between.
  const aBottomY = a.y + a.height;
  const bBottomY = b.y + b.height;
  const aCenterX = a.x + a.width / 2;
  const bCenterX = b.x + b.width / 2;
  if (b.y >= aBottomY) {
    if (Math.abs(aCenterX - bCenterX) < 0.5) {
      return [point(aCenterX, aBottomY), point(bCenterX, b.y)];
    }
    const channelY = (aBottomY + b.y) / 2;
    return [
      point(aCenterX, aBottomY),
      point(aCenterX, channelY),
      point(bCenterX, channelY),
      point(bCenterX, b.y),
    ];
  }
  if (bBottomY <= a.y) {
    if (Math.abs(aCenterX - bCenterX) < 0.5) {
      return [point(aCenterX, a.y), point(bCenterX, bBottomY)];
    }
    const channelY = (a.y + bBottomY) / 2;
    return [
      point(aCenterX, a.y),
      point(aCenterX, channelY),
      point(bCenterX, channelY),
      point(bCenterX, bBottomY),
    ];
  }

  // Overlapping on both axes: escape around the RIGHT side of both boxes.
  const channelX = Math.max(aRightX, bRightX) + CHANNEL_GAP;
  return [
    point(aRightX, aMidY),
    point(channelX, aMidY),
    point(channelX, bMidY),
    point(b.x, bMidY),
  ];
}

/** Midpoint along the polyline arc length - the anchor for relation labels,
 *  matching where the old straight lines drew theirs. */
export function polylineLabelPoint(points: RoutePoint[]): RoutePoint {
  if (points.length === 0) return point(0, 0);
  if (points.length === 1) return points[0]!;
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    const length = Math.hypot(dx, dy);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i]! || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i]!;
      return point(
        points[i]!.x + (points[i + 1]!.x - points[i]!.x) * t,
        points[i]!.y + (points[i + 1]!.y - points[i]!.y) * t,
      );
    }
    remaining -= lengths[i]!;
  }
  return points[points.length - 1]!;
}

/** SVG path data for a routed polyline (`M x y L x y …`). */
export function routePathData(points: RoutePoint[]): string {
  return points.map((pt, index) => `${index === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`).join(' ');
}
