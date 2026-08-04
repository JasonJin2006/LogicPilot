// Center workspace (P1-7): the modeling canvas with a collapsible DSL code
// pane beside it. The pane mirrors the canvas document (one-way for now) and
// compiles it against the gateway; collapsing returns the canvas to full
// width. A TS DSL parser would make the pane editable (DSL -> graph); today
// the direction is graph -> DSL.

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { generateDsl } from '@logicpilot/editor';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useConnectionStore } from '../state/connectionStore';
import { useModelStore } from '../state/modelStore';
import { ModelCanvas } from './ModelCanvas';

const MIN_EDITOR_W = 220;
const MAX_EDITOR_W = 560;

export function ModelWorkspace() {
  const document = useModelStore((state) => state.document);
  const compile = useConnectionStore((state) => state.compile);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorWidth, setEditorWidth] = useState(360);
  const splitterDrag = useRef<{ startX: number; startWidth: number } | null>(null);

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
      <div className="model-canvas-host">
        <ModelCanvas />
      </div>
      {editorOpen ? (
        <>
          <div
            className="dsl-splitter"
            onPointerDown={onSplitterDown}
            onPointerMove={onSplitterMove}
            onPointerUp={onSplitterUp}
            onPointerCancel={onSplitterUp}
          />
          <div className="dsl-editor" style={{ width: editorWidth }}>
            <div className="dsl-editor-header">
              <span className="dsl-title">DSL</span>
              <button className="dsl-compile" onClick={compile}>
                Compile
              </button>
              <button
                className="dsl-collapse"
                title="Collapse DSL editor"
                onClick={() => setEditorOpen(false)}
              >
                <ChevronRight size={13} />
              </button>
            </div>
            <pre className="dsl-source">{generateDsl(document)}</pre>
          </div>
        </>
      ) : (
        <button className="dsl-open" title="Show DSL editor" onClick={() => setEditorOpen(true)}>
          <ChevronLeft size={13} />
          DSL
        </button>
      )}
    </div>
  );
}
