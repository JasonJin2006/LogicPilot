// Presentation object model: a lightweight vector scene-graph node (the
// AnyLogic presentation / Figma-style drawing layer, rendered on the
// simulation canvas as a real SVG shape).
//
// A ModelNode that carries `presentation` is a drawing annotation, not a
// process block: it never emits into the DSL and its geometry lives here
// (width/height/rotation/scale + fill/stroke/opacity) instead of the
// hard-coded 120x80 placeholders of the old presentation layer.

export type PresentationType =
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'arc'
  | 'curve'
  | 'text'
  | 'image'
  | 'group';

export interface PresentationTransform {
  /** Top-left corner in world coordinates (for `line` the start point). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the object's centre. */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface PresentationStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  /** Optional dash pattern (e.g. "6 4"). */
  dash?: string;
}

export interface PresentationTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
}

export interface PresentationObject {
  type: PresentationType;
  transform: PresentationTransform;
  style: PresentationStyle;
  text?: string;
  textStyle?: PresentationTextStyle;
  image?: { src: string; width: number; height: number };
  children?: PresentationObject[];
}

/** Default geometry per shape type (old placeholder sizes: rect 120x80,
 *  oval rx60/ry40, line 120px horizontal, text single line). */
export function defaultPresentationTransform(
  type: PresentationType,
  x: number,
  y: number,
): PresentationTransform {
  const base: PresentationTransform = {
    x,
    y,
    width: 120,
    height: 80,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  switch (type) {
    case 'line':
      return { ...base, height: 0 };
    case 'text':
      return { ...base, height: 24 };
    case 'polyline':
    case 'arc':
    case 'curve':
      return { ...base, height: 64 };
    default:
      return base;
  }
}

export function defaultPresentationStyle(): PresentationStyle {
  return { fill: '#ffffff', stroke: '#333333', strokeWidth: 1.5, opacity: 1 };
}

export function defaultPresentationObject(
  type: PresentationType,
  x: number,
  y: number,
): PresentationObject {
  return {
    type,
    transform: defaultPresentationTransform(type, x, y),
    style: defaultPresentationStyle(),
    ...(type === 'text'
      ? {
          text: 'Text',
          textStyle: {
            fontFamily: 'Arial',
            fontSize: 16,
            fontWeight: 400,
            align: 'center' as const,
          },
        }
      : {}),
  };
}
