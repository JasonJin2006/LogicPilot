// Center workspace (P1-7): the modeling canvas with a collapsible DSL code
// pane beside it. The pane mirrors the canvas document (one-way for now) and
// compiles it against the gateway; collapsing returns the canvas to full
// width. A TS DSL parser would make the pane editable (DSL -> graph); today
// the direction is graph -> DSL.

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { generateDsl } from '@logicpilot/editor';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { mergeModelSource } from '../project/project';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { ModelCanvas } from './ModelCanvas';

const MIN_EDITOR_W = 220;
const MAX_EDITOR_W = 560;

export function ModelWorkspace() {
  const document = useModelStore((state) => state.document);
  const compile = useConnectionStore((state) => state.compile);
  const openRunDialog = useUiStore((state) => state.openRunDialog);
  const dslEditorFile = useUiStore((state) => state.dslEditorFile);
  const closeDslEditor = useUiStore((state) => state.closeDslEditor);
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorWidth, setEditorWidth] = useState(360);
  const splitterDrag = useRef<{ startX: number; startWidth: number } | null>(null);

  // Opening a file from the Explorer reveals the editor pane.
  useEffect(() => {
    if (dslEditorFile !== null) {
      setEditorOpen(true);
    }
  }, [dslEditorFile]);

  const fileSource = dslEditorFile !== null && bundle ? bundle.files[dslEditorFile] : undefined;
  const isFileEditor = fileSource !== undefined;
  const mergedSource = bundle
    ? mergeModelSource(
        bundle.files[bundle.manifest.model] ?? '',
        bundle.files,
        bundle.manifest.modelParts ?? [],
      )
    : undefined;
  const compileSource = isFileEditor ? mergedSource : undefined;

  const onSplitterDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    splitterDrag.current = { startX: event.clientX, startWidth: editorWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSplitterMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = splitterDrag.current;
    if (!gesture) return;
    const width = gesture.startWidth + (gesture.startX - event.clientX);
    setEditorWidth(Math.min(MAX_EDITOR_W, Math.max(MIN_EDITOR_W, width)));
  };

  const onSplitterUp = () => {
    splitterDrag.current = null;
  };

  return (
    <div className="model-workspace">
      <button className="canvas-run" title="Run the model" onClick={openRunDialog}>
        <Play size={12} />
        Run
      </button>
      <div className="model-canvas-host">
        <ModelCanvas />
      </div>
      {editorOpen && (
        <>
          <div
            className="dsl-splitter"
            onPointerDown={onSplitterDown}
            onPointerMove={onSplitterMove}
            onPointerUp={onSplitterUp}
            onPointerCancel={onSplitterUp}
          />
          <div className="dsl-editor" style={{ width: editorWidth }}>
            <button
              className="dsl-edge-tab"
              title="Collapse DSL editor"
              onClick={() => setEditorOpen(false)}
            >
              <ChevronRight size={13} />
            </button>
            <div className="dsl-editor-header">
              <span className="dsl-title">
                {isFileEditor ? dslEditorFile : 'DSL (canvas)'}
              </span>
              {isFileEditor && (
                <button className="dsl-close-file" title="Close file" onClick={closeDslEditor}>
                  ×
                </button>
              )}
              <button className="dsl-compile" onClick={() => compile(compileSource)}>
                Compile
              </button>
            </div>
            {isFileEditor && dslEditorFile !== null ? (
              <textarea
                className="dsl-source dsl-textarea"
                value={fileSource}
                spellCheck={false}
                onChange={(event) =>
                  updateFiles((files) => ({ ...files, [dslEditorFile]: event.target.value }))
                }
              />
            ) : (
              <pre className="dsl-source">{generateDsl(document)}</pre>
            )}
          </div>
        </>
      )}
      {!editorOpen && (
        <button
          className="dsl-edge-tab"
          title="Show DSL editor"
          onClick={() => setEditorOpen(true)}
        >
          <ChevronLeft size={13} />
        </button>
      )}
    </div>
  );
}
