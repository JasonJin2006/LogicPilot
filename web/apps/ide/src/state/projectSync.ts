// Best-effort canvas reload from the project's merged model source: used
// after Project-tree or file edits so the process-flow canvas reflects the
// current DSL (only when the merged source stays in the canvas subset).

import { parseDsl } from '@logicpilot/editor';
import { mergeModelSource } from '../project/project';
import { useModelStore } from './modelStore';
import { useProjectStore } from './projectStore';

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
