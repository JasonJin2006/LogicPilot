// Center tab (DSL): the project's code editor. The file name and close
// button live on the tab bar; Compile / Save live in the tab bar's
// contextual action area.
//
// Bundle-file edits re-parse into the canvas on a short debounce
// (refreshCanvasDocument), so text and canvas stay projections of one
// authoritative revision (plan §6). Disk files outside a project have no
// bundle to merge against, so they edit as plain source until Save.
//
// Completions are contributed per document type (DocumentContribution.
// completions) - this editor renders the generic overlay and knows no
// keywords itself. Trigger: Ctrl+Space; ArrowUp/Down navigate, Enter/Tab
// accept, Escape dismisses; typing keeps it open while items remain.

import { generateDsl } from '@logicpilot/editor';
import { useEffect, useRef, useState } from 'react';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { refreshCanvasDocument } from '../state/projectSync';
import { documentContributionFor, type DocumentCompletionItem } from '../workbench/documentTypes';
import { ScrollArea } from '../components/ScrollArea';
import { caretPosition } from './caret';

const REFRESH_DEBOUNCE_MS = 300;

interface CompletionState {
  items: readonly DocumentCompletionItem[];
  selected: number;
  /** Span of the word being completed (replaced on accept). */
  wordStart: number;
  caret: number;
  top: number;
  left: number;
}

/** Approximate caret pixel position inside a monospace textarea (good
 *  enough to anchor the overlay under the caret). */
function caretPixel(el: HTMLTextAreaElement, offset: number): { top: number; left: number } {
  const style = window.getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
  const charWidth = parseFloat(style.fontSize) * 0.6 || 7.2;
  const before = el.value.slice(0, offset);
  const lineIndex = before.split('\n').length - 1;
  const column = before.length - (before.lastIndexOf('\n') + 1);
  return {
    top: (lineIndex + 1) * lineHeight - el.scrollTop,
    left: column * charWidth - el.scrollLeft + 8,
  };
}

function wordStartBefore(value: string, caret: number): number {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.:]/.test(value[start - 1] ?? '')) start -= 1;
  return start;
}

export function DslEditor() {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const refreshTimer = useRef<number | undefined>(undefined);
  const document = useModelStore((state) => state.document);
  const activeFile = useUiStore((state) => state.activeFile);
  const updateDiskFile = useUiStore((state) => state.updateDiskFile);
  const diskContent = useUiStore((state) => (activeFile ? state.diskFiles[activeFile] : undefined));
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const reveal = useUiStore((state) => state.sourceReveal);
  const [completion, setCompletion] = useState<CompletionState | null>(null);

  const fileSource = activeFile !== null && bundle ? bundle.files[activeFile] : undefined;
  const isDiskFile = diskContent !== undefined;
  const isFileEditor = isDiskFile || fileSource !== undefined;
  // Only contributed languages get the overlay; plain files never do.
  const completionsFor =
    activeFile !== null ? documentContributionFor(activeFile)?.completions : undefined;

  // Coalesce keystrokes: one re-parse per pause, not per character.
  const scheduleCanvasRefresh = () => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refreshCanvasDocument, REFRESH_DEBOUNCE_MS);
  };

  const writeEditor = (next: string) => {
    if (activeFile === null) return;
    if (isDiskFile) {
      updateDiskFile(activeFile, next);
      return;
    }
    updateFiles((files) => ({ ...files, [activeFile]: next }));
    scheduleCanvasRefresh();
  };

  // The editor is the only thing that knows where the caret is, so it
  // publishes the position instead of the status bar reaching into the
  // textarea. Reported imperatively (never through a subscription) so moving
  // the caret cannot re-render the editor itself.
  const publishCaret = (el: HTMLTextAreaElement | null) => {
    if (el === null || activeFile === null) {
      useUiStore.getState().setEditorCaret(null);
      return;
    }
    useUiStore.getState().setEditorCaret({
      path: activeFile,
      ...caretPosition(el.value, el.selectionStart),
    });
  };

  // Language-service handoff: focus the editor and select the requested
  // span (go-to-definition / reveal from the SysML projection). The caret
  // selection makes browsers scroll it into view.
  useEffect(() => {
    if (reveal === null || reveal.path !== activeFile || !editorRef.current) return;
    const el = editorRef.current;
    el.focus();
    el.setSelectionRange(reveal.start, reveal.end);
    useUiStore.getState().clearSourceReveal();
    publishCaret(el);
  }, [reveal, activeFile]);

  // A file switch reuses the same textarea element, so the selection event
  // alone would leave the previous file's position behind: republish whenever
  // the front file or its text changes.
  useEffect(() => {
    publishCaret(editorRef.current);
  }, [activeFile, fileSource, diskContent]);

  const openOrRefreshCompletion = () => {
    const el = editorRef.current;
    if (el === null || completionsFor === undefined) return;
    const caret = el.selectionStart;
    const items = completionsFor(el.value, caret);
    if (items.length === 0) {
      setCompletion(null);
      return;
    }
    setCompletion({
      items,
      selected: 0,
      wordStart: wordStartBefore(el.value, caret),
      caret,
      ...caretPixel(el, caret),
    });
  };

  const acceptCompletion = (item: DocumentCompletionItem) => {
    const el = editorRef.current;
    if (el === null || completion === null) return;
    const value = el.value;
    const next = `${value.slice(0, completion.wordStart)}${item.insertText}${value.slice(completion.caret)}`;
    writeEditor(next);
    setCompletion(null);
    requestAnimationFrame(() => {
      const caret = completion.wordStart + item.insertText.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && event.key === ' ') {
      event.preventDefault();
      openOrRefreshCompletion();
      return;
    }
    if (completion === null) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const count = completion.items.length;
      setCompletion({
        ...completion,
        selected: (completion.selected + delta + count) % count,
      });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      acceptCompletion(completion.items[completion.selected]!);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setCompletion(null);
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    if (activeFile === null) return;
    if (isDiskFile) {
      updateDiskFile(activeFile, next);
      return;
    }
    updateFiles((files) => ({ ...files, [activeFile]: next }));
    scheduleCanvasRefresh();
    // Typing keeps an open popup alive with fresh candidates.
    if (completion !== null && completionsFor !== undefined) {
      requestAnimationFrame(() => openOrRefreshCompletion());
    }
  };

  const textareaProps = {
    className: 'dsl-source dsl-textarea scroll-hidden',
    spellCheck: false,
    onKeyDown: handleKeyDown,
    onBlur: () => setCompletion(null),
    onChange: handleChange,
    // Every caret move (typing, arrows, clicks) reports its position.
    onSelect: (event: React.SyntheticEvent<HTMLTextAreaElement>) =>
      publishCaret(event.currentTarget),
  } as const;

  return (
    <div className="dsl-editor">
      {isDiskFile ? (
        <ScrollArea className="dsl-source-scroll" scrollRef={editorRef}>
          <textarea ref={editorRef} value={diskContent} {...textareaProps} />
        </ScrollArea>
      ) : isFileEditor && activeFile !== null ? (
        <ScrollArea className="dsl-source-scroll" scrollRef={editorRef}>
          <textarea ref={editorRef} value={fileSource} {...textareaProps} />
        </ScrollArea>
      ) : (
        <ScrollArea className="dsl-source-scroll">
          <pre className="dsl-source">{generateDsl(document)}</pre>
        </ScrollArea>
      )}
      {completion !== null && (
        <ul
          className="dsl-completion"
          style={{ top: completion.top, left: Math.max(8, completion.left) }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {completion.items.slice(0, 12).map((item, index) => (
            <li key={`${item.label}:${index}`}>
              <button
                type="button"
                className={index === completion.selected ? 'active' : ''}
                onClick={() => acceptCompletion(item)}
              >
                <span>{item.label}</span>
                {item.detail !== undefined && <em>{item.detail}</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
