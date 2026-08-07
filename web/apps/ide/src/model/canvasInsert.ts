// Shared "add a palette block to the active canvas" entry used by both the
// canvas drop handler and the palette double-click fallback (a reliable
// path when HTML5 drag-and-drop is unavailable, e.g. some WebView2 hosts).
import { useModelStore } from '../state/modelStore';
import { useCanvasView } from '../state/canvasView';
import { BLOCK_DEFAULTS } from './blockDefs';
import { PRESENTATION_KINDS } from './blockDefs';
import { createGraphicNode } from '@logicpilot/editor';

let cascade = 0;

/**
 * Insert a palette block into the active canvas. When `world` is omitted the
 * block lands at a small cascade near the view's top-left so it stays
 * visible without a drag ghost. Mirrors the canvas onDrop container rules:
 * process stages land inside the focused container (or an auto-created
 * `Flow` on the model root); everything else lands at model level.
 */
export function insertBlockAt(
  kind: string,
  library: string,
  world?: { x: number; y: number },
): void {
  const { addBlock } = useModelStore.getState();
  const { view } = useCanvasView.getState();
  const pos = world ?? {
    x: 140 + (cascade % 8) * 28,
    y: 90 + Math.floor((cascade % 8) / 4) * 40,
  };
  cascade += 1;

  const isStage =
    kind !== 'resource' &&
    (library === undefined || library === 'process' || library === 'statechart');
  let container: string | undefined;
  if (isStage) {
    if (view) {
      container = view.name;
    }
    // At the model root (no focused container) process blocks land directly
    // in the root scope (agent-centric), so they render on the root canvas.
  }
  addBlock({
    kind,
    name: kind,
    x: pos.x,
    y: pos.y,
    params: BLOCK_DEFAULTS[kind],
    library,
    container,
    // Presentation shapes start as real vector objects (resizable, styleable)
    // instead of the old fixed 120x80 placeholder.
    ...(PRESENTATION_KINDS.has(kind)
      ? { presentation: createGraphicNode(kind, pos.x, pos.y) }
      : {}),
  });
}
