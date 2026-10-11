// Best-effort canvas reload from the project's merged model source: used
// after Project-tree or file edits so the process-flow canvas reflects the
// current DSL (only when the merged source stays in the canvas subset).

import { parseDsl } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import { mergeModelSource } from '../project/project';
import { useCanvasView } from './canvasView';
import { useModelStore } from './modelStore';
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';
import { logConsoleEvent } from './legacyGateway';

/** Load a freshly parsed document and show its root canvas (a new project or
 *  an opened model should never land inside a stale container view). */
export function loadModelDocument(document: ModelDocument): void {
  useModelStore.getState().loadDocument(document);
  // A different model is loaded: close every container tab and open file
  // tab, then open the new model's root canvas (tabs only exist once opened).
  useUiStore.getState().closeAllFiles();
  useCanvasView.getState().resetCanvasViews();
  useCanvasView.getState().setView(null);
}

function mergedModelSource(): string | null {
  const current = useProjectStore.getState().bundle;
  if (!current) {
    return null;
  }
  return mergeModelSource(
    current.files[current.manifest.model] ?? '',
    current.files,
    current.manifest.modelParts ?? [],
  );
}

/** Swap the canvas document for one re-parsed from the current files WITHOUT
 *  touching open file tabs or container views: text editor, Project tree and
 *  canvas stay projections of the same authoritative revision (plan §6).
 *  Source that no longer parses keeps the last valid model; the diagnostic
 *  lands in the console (VS Code-style error model). */
export function refreshCanvasDocument(): void {
  const merged = mergedModelSource();
  if (merged === null) {
    return;
  }
  const parsed = parseDsl(merged);
  if (parsed.ok) {
    useModelStore.getState().loadDocument(parsed.document);
  } else {
    const code = parsed.diagnostics?.[0]?.code ?? 'LP2101';
    logConsoleEvent('error', `${code}: ${parsed.error ?? 'invalid DSL'}`);
  }
}

/** Full reload from the project's merged model source for "a different
 *  model arrived" flows: parses, swaps the document AND closes open file /
 *  container tabs so no stale projection survives. */
export function syncCanvasFromProject(): void {
  const merged = mergedModelSource();
  if (merged === null) {
    return;
  }
  const canvas = parseDsl(merged);
  if (canvas.ok) {
    loadModelDocument(canvas.document);
  } else {
    // The DSL no longer parses: keep the last valid model and surface the
    // structure diagnostics in the console (VS Code-style error model).
    const code = canvas.diagnostics?.[0]?.code ?? 'LP2101';
    logConsoleEvent('error', `${code}: ${canvas.error ?? 'invalid DSL'}`);
  }
}
