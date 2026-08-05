// Best-effort canvas reload from the project's merged model source: used
// after Project-tree or file edits so the process-flow canvas reflects the
// current DSL (only when the merged source stays in the canvas subset).

import { parseDsl } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import { mergeModelSource } from '../project/project';
import { useCanvasView } from './canvasView';
import { useModelStore } from './modelStore';
import { useProjectStore } from './projectStore';

/** Load a freshly parsed document and show its root canvas (a new project or
 *  an opened model should never land inside a stale container view). */
export function loadModelDocument(document: ModelDocument): void {
  useModelStore.getState().loadDocument(document);
  useCanvasView.getState().setView(null);
}

export function syncCanvasFromProject(): void {
  const current = useProjectStore.getState().bundle;
  if (!current) {
    return;
  }
  const merged = mergeModelSource(
    current.files[current.manifest.model] ?? '',
    current.files,
    current.manifest.modelParts ?? [],
  );
  const canvas = parseDsl(merged);
  if (canvas.ok) {
    useModelStore.getState().loadDocument(canvas.document);
  }
}
