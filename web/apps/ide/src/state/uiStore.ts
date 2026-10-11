// Transient UI state (dialogs and overlays) that does not belong to a
// domain store.

import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  runDialogOpen: boolean;
  newProjectOpen: boolean;
  /** Bundle files open as code tabs (one tab per file, VS Code style). */
  openFiles: string[];
  /** The file tab currently in front. */
  activeFile: string | null;
  /** Read-only contents of on-disk files opened from the Explorer (files
   *  that are not part of the bundle, e.g. build artifacts). */
  diskFiles: Record<string, string>;
  /** Multi-action confirm dialog (e.g. Close project with unsaved work). */
  confirm: {
    title: string;
    body: string;
    actions: Array<{ label: string; primary?: boolean; onSelect: () => void }>;
    /** Called when the dialog is dismissed without an action (X/backdrop). */
    dismiss?: () => void;
  } | null;
  prompt: {
    title: string;
    label: string;
    initial: string;
    submitLabel?: string;
    onSubmit: (value: string) => void;
  } | null;
  info: { title: string; body: string } | null;
  openSettings: () => void;
  closeSettings: () => void;
  openRunDialog: () => void;
  closeRunDialog: () => void;
  openNewProject: () => void;
  closeNewProject: () => void;
  openFile: (path: string) => void;
  openDiskFile: (path: string, content: string) => void;
  updateDiskFile: (path: string, content: string) => void;
  /** Caret reported by the text editor that is in front, 1-based. Carries the
   *  path so a consumer can tell a live position from one left behind by
   *  another file. null while no text editor has reported a position. */
  editorCaret: { path: string; line: number; column: number } | null;
  setEditorCaret: (caret: UiState['editorCaret']) => void;
  /** Language-service handoff: select [start,end) in the file's text editor
   *  (SysML go-to-definition / reveal). Consumers clear it after use. */
  sourceReveal: { path: string; start: number; end: number; nonce: number } | null;
  revealInSource: (path: string, start: number, end: number) => void;
  clearSourceReveal: () => void;
  closeFile: (path: string) => void;
  closeAllFiles: () => void;
  openPrompt: (prompt: UiState['prompt']) => void;
  closePrompt: () => void;
  openConfirm: (confirm: NonNullable<UiState['confirm']>) => void;
  closeConfirm: () => void;
  openInfo: (title: string, body: string) => void;
  closeInfo: () => void;
  /** AI panel tool switches (here so Settings can change them too). */
  aiToolsEnabled: boolean;
  aiSourceEditingEnabled: boolean;
  setAiToolsEnabled: (enabled: boolean) => void;
  setAiSourceEditingEnabled: (enabled: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  runDialogOpen: false,
  newProjectOpen: false,
  openFiles: [],
  activeFile: null,
  diskFiles: {},
  confirm: null,
  prompt: null,
  info: null,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openRunDialog: () => set({ runDialogOpen: true }),
  closeRunDialog: () => set({ runDialogOpen: false }),
  openNewProject: () => set({ newProjectOpen: true }),
  closeNewProject: () => set({ newProjectOpen: false }),
  openFile: (path) =>
    set((state) => ({
      openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
      activeFile: path,
    })),
  closeFile: (path) =>
    set((state) => {
      const openFiles = state.openFiles.filter((entry) => entry !== path);
      const activeFile = state.activeFile === path ? (openFiles[0] ?? null) : state.activeFile;
      return { openFiles, activeFile };
    }),
  openDiskFile: (path, content) =>
    set((state) => ({
      diskFiles: { ...state.diskFiles, [path]: content },
      openFiles: state.openFiles.includes(path) ? state.openFiles : [...state.openFiles, path],
      activeFile: path,
    })),
  updateDiskFile: (path, content) =>
    set((state) => ({
      diskFiles: { ...state.diskFiles, [path]: content },
    })),
  sourceReveal: null,
  editorCaret: null,
  // Ignore repeat reports: the editor republishes on every selection change,
  // and re-rendering the status bar for an unchanged position is pure churn.
  setEditorCaret: (caret) =>
    set((state) => {
      const current = state.editorCaret;
      if (
        current === caret ||
        (current !== null &&
          caret !== null &&
          current.path === caret.path &&
          current.line === caret.line &&
          current.column === caret.column)
      ) {
        return {};
      }
      return { editorCaret: caret };
    }),
  revealInSource: (path, start, end) =>
    set((state) => ({
      sourceReveal: {
        path,
        start,
        end,
        nonce: (state.sourceReveal?.nonce ?? 0) + 1,
      },
    })),
  clearSourceReveal: () => set({ sourceReveal: null }),
  closeAllFiles: () => set({ openFiles: [], activeFile: null, diskFiles: {} }),
  openPrompt: (prompt) => set({ prompt }),
  closePrompt: () => set({ prompt: null }),
  openConfirm: (confirm) => set({ confirm }),
  closeConfirm: () =>
    set((state) => {
      // Dismissal must release any flow awaiting the dialog, or the
      // underlying Save/Close continuation hangs forever.
      state.confirm?.dismiss?.();
      return { confirm: null };
    }),
  openInfo: (title, body) => set({ info: { title, body } }),
  closeInfo: () => set({ info: null }),
  aiToolsEnabled: true,
  aiSourceEditingEnabled: false,
  setAiToolsEnabled: (aiToolsEnabled) => set({ aiToolsEnabled }),
  setAiSourceEditingEnabled: (aiSourceEditingEnabled) => set({ aiSourceEditingEnabled }),
}));
