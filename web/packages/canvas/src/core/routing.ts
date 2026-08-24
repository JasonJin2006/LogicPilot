import type { GraphicTransform, Point } from '@logicpilot/editor';

export interface OrthogonalRoute {
  transform: GraphicTransform;
  points: Point[];
}

function center(t: GraphicTransform) {
  return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
}

/** Route an elbow connector from the nearest facing edges of two objects.
 * Points are normalized for GraphicNode polyline geometry. */
export function routeOrthogonal(from: GraphicTransform, to: GraphicTransform): OrthogonalRoute {
  const aCenter = center(from);
  const bCenter = center(to);
  const horizontal = Math.abs(bCenter.x - aCenter.x) >= Math.abs(bCenter.y - aCenter.y);
  const start = horizontal
    ? {
        x: bCenter.x >= aCenter.x ? from.x + from.width : from.x,
        y: aCenter.y,
      }
    : {
        x: aCenter.x,
        y: bCenter.y >= aCenter.y ? from.y + from.height : from.y,
      };
  const end = horizontal
    ? {
        x: bCenter.x >= aCenter.x ? to.x : to.x + to.width,
        y: bCenter.y,
      }
    : {
        x: bCenter.x,
        y: bCenter.y >= aCenter.y ? to.y : to.y + to.height,
      };
  const absolute = horizontal
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [
        start,
        { x: start.x, y: (start.y + end.y) / 2 },
        { x: end.x, y: (start.y + end.y) / 2 },
        end,
      ];
  const minX = Math.min(...absolute.map((point) => point.x));
  const minY = Math.min(...absolute.map((point) => point.y));
  const width = Math.max(1, Math.max(...absolute.map((point) => point.x)) - minX);
  const height = Math.max(1, Math.max(...absolute.map((point) => point.y)) - minY);
  return {
    transform: {
      x: minX,
      y: minY,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
    },
    points: absolute.map((point) => ({
      x: (point.x - minX) / width,
      y: (point.y - minY) / height,
    })),
  };
}
