// Click-vs-drag classification shared by every paradigm canvas. Before
// this lived as three ad-hoc `moved` booleans with three different slop
// radii in ModelCanvas; the kernel owns the semantics so a click means
// the same thing everywhere.

import type { Point } from './types.js';

export class PressGesture {
  static readonly DEFAULT_SLOP_PX = 3;

  private startPoint: Point | null = null;
  private slopPx = PressGesture.DEFAULT_SLOP_PX;
  private crossed = false;

  begin(point: Point, slopPx: number = PressGesture.DEFAULT_SLOP_PX): void {
    if (!(slopPx > 0)) {
      throw new RangeError('slopPx must be > 0');
    }
    this.startPoint = { x: point.x, y: point.y };
    this.slopPx = slopPx;
    this.crossed = false;
  }

  /** Feed a pointer-move sample. Returns true exactly once - on the update
   *  where the pointer first crosses the slop radius ("drag started"). */
  update(point: Point): boolean {
    if (this.startPoint === null || this.crossed) {
      return false;
    }
    const distance = Math.hypot(point.x - this.startPoint.x, point.y - this.startPoint.y);
    if (distance >= this.slopPx) {
      this.crossed = true;
      return true;
    }
    return false;
  }

  /** True when the press grew into a drag (checked at pointer-up). */
  get moved(): boolean {
    return this.active && this.crossed;
  }

  /** Press origin (screen coordinates); null when no press is active. */
  get origin(): Point | null {
    return this.startPoint === null ? null : { x: this.startPoint.x, y: this.startPoint.y };
  }

  get active(): boolean {
    return this.startPoint !== null;
  }

  end(): void {
    this.startPoint = null;
    this.crossed = false;
  }
}
