// Center tab (DSL): the project's code editor. The file name and close
// button live on the tab bar; Compile / Save live in the tab bar's
// contextual action area.
//
// Bundle-file edits re-parse into the canvas on a short debounce
// (refreshCanvasDocument), so text and canvas stay projections of one
// authoritative revision (plan §6). Disk files outside a project have no
// bundle to merge against, so they edit as plain source until Save.

import { generateDsl } from '@logicpilot/editor';
import { useRef } from 'react';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { refreshCanvasDocument } from '../state/projectSync';
import { ScrollArea } from '../components/ScrollArea';

const REFRESH_DEBOUNCE_MS = 300;

export function DslEditor() {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const refreshTimer = useRef<number | undefined>(undefined);
  const document = useModelStore((state) => state.document);
  const activeFile = useUiStore((state) => state.activeFile);
  const updateDiskFile = useUiStore((state) => state.updateDiskFile);
  const diskContent = useUiStore((state) => (activeFile ? state.diskFiles[activeFile] : undefined));
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);

  const fileSource = activeFile !== null && bundle ? bundle.files[activeFile] : undefined;
  const isDiskFile = diskContent !== undefined;
  const isFileEditor = isDiskFile || fileSource !== undefined;

  // Coalesce keystrokes: one re-parse per pause, not per character.
  const scheduleCanvasRefresh = () => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refreshCanvasDocument, REFRESH_DEBOUNCE_MS);
  };

  return (
    <div className="dsl-editor">
      {isDiskFile ? (
        <ScrollArea className="dsl-source-scroll" scrollRef={editorRef}>
          <textarea
            ref={editorRef}
            className="dsl-source dsl-textarea scroll-hidden"
            value={diskContent}
            spellCheck={false}
            onChange={(event) =>
              activeFile !== null && updateDiskFile(activeFile, event.target.value)
            }
          />
        </ScrollArea>
      ) : isFileEditor && activeFile !== null ? (
        <ScrollArea className="dsl-source-scroll" scrollRef={editorRef}>
          <textarea
            ref={editorRef}
            className="dsl-source dsl-textarea scroll-hidden"
            value={fileSource}
            spellCheck={false}
            onChange={(event) => {
              updateFiles((files) => ({ ...files, [activeFile]: event.target.value }));
              scheduleCanvasRefresh();
            }}
          />
        </ScrollArea>
      ) : (
        <ScrollArea className="dsl-source-scroll">
          <pre className="dsl-source">{generateDsl(document)}</pre>
        </ScrollArea>
      )}
    </div>
  );
}
