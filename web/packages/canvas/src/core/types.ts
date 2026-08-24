// Shared geometry types for the canvas platform kernel. Paradigm documents
// stay in their own packages; these shapes are the lingua franca between
// the kernel's pure helpers and the host adapters.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Pan/zoom state of one canvas surface. `panX/panY` are the world origin's
 *  screen position, so screen = world * scale + pan. */
export interface Camera {
  scale: number;
  panX: number;
  panY: number;
}
