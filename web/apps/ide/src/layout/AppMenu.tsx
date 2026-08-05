// Desktop-style application menu (File / Edit / View / Help) with dropdowns.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { generateDsl, parseDsl } from '@logicpilot/editor';
import type { BlockKind, ModelDocument } from '@logicpilot/editor';
import { useCanvasView } from '../state/canvasView';
import { useModelStore } from '../state/modelStore';
import { useLayoutStore } from '../state/layoutStore';
import { useUiStore } from '../state/uiStore';
import { addRecent, loadRecent } from '../state/recentStore';
import { useProjectStore } from '../state/projectStore';
import {
  DEFAULT_MODEL_PATH,
  bundleToJson,
  createProjectBundle,
  mergeCanvasSplit,
  parseProjectBundle,
  projectToDiskFiles,
  projectToDocument,
  splitModelSource,
} from '../project/project';
import { isTauri, pickProjectFolder, readProjectDir, writeProjectFiles } from '../state/tauriFs';

interface MenuEntry {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  action?: () => void;
}

type MenuEntryOrBreak =
  | MenuEntry
  | { kind: 'separator' }
  | { kind: 'sectionLabel'; label: string };

// Clipboard for Edit > Cut/Copy/Paste (a block, not canvas text).
let clipboard: {
  kind: BlockKind;
  name: string;
  params: Record<string, string | number | boolean>;
  library?: string;
} | null = null;

export function AppMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const modelDoc = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const addBlock = useModelStore((state) => state.addBlock);
  const removeBlock = useModelStore((state) => state.removeBlock);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const setCanvasView = useCanvasView((state) => state.setView);
  const undo = useModelStore((state) => state.undo);
  const redo = useModelStore((state) => state.redo);
  const canUndo = useModelStore((state) => state.canUndo);
  const canRedo = useModelStore((state) => state.canRedo);
  const areas = useLayoutStore((state) => state.areas);
  const setActive = useLayoutStore((state) => state.setActive);
  const reopenArea = useLayoutStore((state) => state.reopenArea);
  const toggleCollapse = useLayoutStore((state) => state.toggleCollapse);
  const openInfo = useUiStore((state) => state.openInfo);
  const openNewProject = useUiStore((state) => state.openNewProject);
  const openBundle = useProjectStore((state) => state.openBundle);
  const clearProject = useProjectStore((state) => state.clearProject);
  const setPath = useProjectStore((state) => state.setPath);
  const markClean = useProjectStore((state) => state.markClean);

  const selected = (modelDoc?.nodes ?? []).find((node) => node.id === selectedId) ?? null;
  const close = () => setOpen(null);
  // Opening a different model shows its root canvas, not a stale container.
  const openDocument = (document: ModelDocument) => {
    loadDocument(document);
    setCanvasView(null);
  };

  const fileNewProject = () => {
    openNewProject();
    close();
  };
  const fileOpen = () => {
    fileRef.current?.click();
    close();
  };
  const fileOpenProjectFolder = async () => {
    const dir = await pickProjectFolder();
    if (!dir) {
      return;
    }
    const result = await readProjectDir(dir);
    if (!result.ok || !result.manifestJson || !result.files) {
      openInfo('Open failed', result.error ?? 'cannot read the project folder');
      return;
    }
    try {
      const envelope = {
        schema: 'logicpilot.project',
        format: 'bundle' as const,
        version: 1,
        manifest: JSON.parse(result.manifestJson) as Record<string, unknown>,
        files: result.files,
      };
      const parsedBundle = parseProjectBundle(JSON.stringify(envelope));
      if (!parsedBundle.ok) {
        openInfo('Open failed', parsedBundle.error ?? 'invalid manifest');
        return;
      }
      const loaded = projectToDocument(parsedBundle.bundle!);
      if (!loaded.ok) {
        openInfo('Open failed', loaded.error ?? 'invalid project');
        return;
      }
      openBundle(parsedBundle.bundle!);
      setPath(dir);
      openDocument(loaded.document!);
      markClean();
      addRecent({
        name: parsedBundle.bundle!.manifest.name,
        bundle: JSON.stringify(parsedBundle.bundle!),
        at: Date.now(),
      });
    } catch (error) {
      openInfo('Open failed', String(error));
    }
    close();
  };
  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((text) => {
      if (file.name.toLowerCase().endsWith('.lpproj')) {
        const parsedBundle = parseProjectBundle(text);
        if (!parsedBundle.ok) {
          openInfo('Open failed', parsedBundle.error ?? 'invalid project');
          return;
        }
        const loaded = projectToDocument(parsedBundle.bundle!);
        if (!loaded.ok) {
          openInfo('Open failed', loaded.error ?? 'invalid project');
          return;
        }
        openBundle(parsedBundle.bundle!);
        openDocument(loaded.document!);
        markClean();
        addRecent({ name: loaded.document!.name, bundle: text, at: Date.now() });
        return;
      }
      if (file.name.toLowerCase().endsWith('.json')) {
        clearProject();
        try {
          const parsed = JSON.parse(text) as unknown;
          const documentLike =
            parsed !== null &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { nodes?: unknown }).nodes) &&
            Array.isArray((parsed as { edges?: unknown }).edges);
          if (!documentLike) {
            openInfo('Open failed', 'not a LogicPilot canvas document (.json)');
            return;
          }
          openDocument(parsed as never);
          markClean();
          const parsedName =
            typeof (parsed as { name?: unknown }).name === 'string'
              ? (parsed as { name: string }).name
              : modelDoc.name || 'Model';
          addRecent({ name: parsedName, dsl: generateDsl(parsed as never), at: Date.now() });
        } catch (error) {
          openInfo('Open failed', String(error));
        }
        return;
      }
      clearProject();
      const parsed = parseDsl(text);
      if (parsed.ok) {
        openDocument(parsed.document);
        markClean();
        addRecent({ name: parsed.document.name, dsl: text, at: Date.now() });
      } else {
        openInfo('Open failed', parsed.error ?? 'invalid DSL');
      }
    });
  };
  const fileSave = async () => {
    const name = modelDoc.name || 'Model';
    const base = createProjectBundle(modelDoc);
    // Split the canvas-generated DSL into per-concern part files.
    const split = splitModelSource(base.files[DEFAULT_MODEL_PATH] ?? '');
    const current = useProjectStore.getState().bundle;
    const project = mergeCanvasSplit(base, split, current);
    const bundle = bundleToJson(project);
    const projectPath = useProjectStore.getState().path;
    if (projectPath) {
      const result = await writeProjectFiles(projectPath, projectToDiskFiles(project));
      if (!result.ok) {
        openInfo('Save failed', result.error ?? 'cannot write the project folder');
        return;
      }
    } else {
      const blob = new Blob([bundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${name}.lpproj`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    openBundle(project);
    markClean();
    addRecent({ name, bundle, at: Date.now() });
    close();
  };
  const exitApp = () => {
    close();
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // not in Tauri: fall through to the browser close
      }
      window.close();
    })();
  };

  const copyBlock = () => {
    if (selected) {
      clipboard = {
        kind: selected.kind,
        name: selected.name,
        params: { ...selected.params },
        library: selected.library,
      };
    }
    close();
  };
  const cutBlock = () => {
    if (selected) {
      clipboard = {
        kind: selected.kind,
        name: selected.name,
        params: { ...selected.params },
        library: selected.library,
      };
      removeBlock(selected.id);
    }
    close();
  };
  const pasteBlock = () => {
    if (!clipboard) {
      close();
      return;
    }
    const base = selected ?? { x: 160, y: 160 };
    addBlock({
      kind: clipboard.kind,
      name: clipboard.name,
      x: base.x + 32,
      y: base.y + 32,
      params: { ...clipboard.params },
      library: clipboard.library,
    });
    close();
  };
  const find = () => {
    document.getElementById('lp-search')?.focus();
    close();
  };

  const showPanel = (
    area: 'left' | 'right',
    panel: 'explorer' | 'modelInfo' | 'palette' | 'properties' | 'ai',
  ) => {
    if (areas[area].collapsed) {
      reopenArea(area, areas[area].size || (area === 'left' ? 280 : 360));
    }
    setActive(area, panel);
    close();
  };
  const showConsole = () => {
    toggleCollapse('bottom');
    close();
  };

  const recent = loadRecent();
  const renderEntry = (entry: MenuEntry, key: string) => (
    <button
      key={key}
      className={`app-menu-entry${entry.checked ? ' checked' : ''}`}
      disabled={entry.disabled}
      onClick={entry.action}
    >
      <span className="app-menu-entry-label">{entry.label}</span>
      {entry.shortcut && <span className="app-menu-entry-shortcut">{entry.shortcut}</span>}
    </button>
  );

  const menus: Array<{ label: string; entries: MenuEntryOrBreak[] }> = [
    {
      label: 'File',
      entries: [
        { label: 'New Project...', shortcut: 'Ctrl+N', action: fileNewProject },
        { label: 'Open...', shortcut: 'Ctrl+O', action: fileOpen },
        ...(isTauri()
          ? [
              {
                label: 'Open Project Folder...',
                action: () => void fileOpenProjectFolder(),
              },
            ]
          : []),
        { kind: 'separator' },
        { kind: 'sectionLabel', label: 'Open Recent' },
        ...(recent.length > 0
          ? recent.map((model) => ({
              label: model.name,
              action: () => {
                if (model.bundle) {
                  const parsedBundle = parseProjectBundle(model.bundle);
                  if (!parsedBundle.ok) {
                    openInfo('Open failed', parsedBundle.error ?? 'invalid project');
                  } else {
                    const loaded = projectToDocument(parsedBundle.bundle!);
                    if (loaded.ok) {
                      openBundle(parsedBundle.bundle!);
                      openDocument(loaded.document!);
                      markClean();
                    } else {
                      openInfo('Open failed', loaded.error ?? 'invalid project');
                    }
                  }
                } else if (model.dsl) {
                  const parsed = parseDsl(model.dsl);
                  if (parsed.ok) {
                    openDocument(parsed.document);
                    markClean();
                  } else {
                    openInfo('Open failed', parsed.error ?? 'invalid DSL');
                  }
                } else {
                  openInfo('Open failed', 'recent model has no saved content');
                }
                close();
              },
            }))
          : [{ label: 'No recent models', disabled: true as const, action: undefined }]),
        { kind: 'separator' },
        { label: 'Save', shortcut: 'Ctrl+S', action: fileSave },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: fileSave },
        { kind: 'separator' },
        { label: 'Exit', action: exitApp },
      ],
    },
    {
      label: 'Edit',
      entries: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, action: () => { undo(); close(); } },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: !canRedo, action: () => { redo(); close(); } },
        { kind: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: !selected, action: cutBlock },
        { label: 'Copy', shortcut: 'Ctrl+C', disabled: !selected, action: copyBlock },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard, action: pasteBlock },
        { kind: 'separator' },
        { label: 'Find', shortcut: 'Ctrl+F', action: find },
      ],
    },
    {
      label: 'View',
      entries: [
        {
          label: 'Explorer',
          checked: areas.left.activePanel === 'explorer',
          action: () => showPanel('left', 'explorer'),
        },
        {
          label: 'Project',
          checked: areas.left.activePanel === 'modelInfo',
          action: () => showPanel('left', 'modelInfo'),
        },
        {
          label: 'Palette',
          checked: areas.left.activePanel === 'palette',
          action: () => showPanel('left', 'palette'),
        },
        {
          label: 'Properties',
          checked: areas.right.activePanel === 'properties',
          action: () => showPanel('right', 'properties'),
        },
        {
          label: 'AI',
          checked: areas.right.activePanel === 'ai',
          action: () => showPanel('right', 'ai'),
        },
        {
          label: 'DSL',
          checked: areas.center.activePanel === 'dsl',
          action: () => {
            useLayoutStore.getState().openPanel('center', 'dsl');
            close();
          },
        },
        {
          label: 'Console',
          checked: !areas.bottom.collapsed,
          action: showConsole,
        },
      ],
    },
    {
      label: 'Help',
      entries: [
        {
          label: 'Welcome',
          action: () => {
            openInfo(
              'Welcome to LogicPilot',
              'AI-native simulation platform: drag-and-drop modeling, DSL v2, a C++ kernel and live visualization. Build a model from the Palette, wire the ports, compile in the DSL editor and press Run.',
            );
            close();
          },
        },
        {
          label: 'Documentation',
          action: () => {
            window.open('http://localhost:5174/', '_blank', 'noopener');
            close();
          },
        },
        {
          label: 'Check for Updates',
          action: () => {
            openInfo(
              'Check for Updates',
              'This is a development build; no update channel is configured.',
            );
            close();
          },
        },
        {
          label: 'About',
          action: () => {
            openInfo(
              'About LogicPilot',
              'LogicPilot v0.1.0 - AI-native simulation platform (C++ kernel, DSL v2, Web IDE / desktop client).',
            );
            close();
          },
        },
      ],
    },
  ];

  // Close the dropdown on outside clicks or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav className="app-menu" ref={barRef} aria-label="Application menu">
      {menus.map((menu) => (
        <div key={menu.label} className="app-menu-root">
          <button
            className={`app-menu-item${open === menu.label ? ' active' : ''}`}
            type="button"
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div className="app-menu-dropdown" role="menu">
              {menu.entries.map((entry, index) => {
                if ('kind' in entry && entry.kind === 'separator') {
                  return <div key={`section-${index}`} className="app-menu-separator" />;
                }
                if ('kind' in entry && entry.kind === 'sectionLabel') {
                  return (
                    <div key={`label-${index}`} className="app-menu-section-label">
                      {entry.label}
                    </div>
                  );
                }
                return renderEntry(entry, `${menu.label}-${index}`);
              })}
            </div>
          )}
        </div>
      ))}
      <input ref={fileRef} type="file" accept=".lpproj,.lp,.json" hidden onChange={onFileChosen} />
    </nav>
  );
}
