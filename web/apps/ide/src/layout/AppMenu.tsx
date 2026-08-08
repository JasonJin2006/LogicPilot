// Desktop-style application menu (File / Edit / View / Help) with dropdowns.

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { parseDsl } from '@logicpilot/editor';
import type { BlockKind, ModelDocument } from '@logicpilot/editor';
import { useCanvasView } from '../state/canvasView';
import { useModelStore } from '../state/modelStore';
import { useLayoutStore } from '../state/layoutStore';
import { useUiStore } from '../state/uiStore';
import { addRecent, loadRecent, removeRecent } from '../state/recentStore';
import { useProjectStore } from '../state/projectStore';
import { logConsoleEvent } from '../state/connectionStore';
import { saveProject } from '../project/syncEngine';
import {
  bundleToJson,
  initializeProject,
  parseProjectBundle,
  projectToDiskFiles,
  projectToDocument,
} from '../project/project';
import { openProjectFromFile } from '../project/openProject';
import {
  isTauri,
  pickProjectFolder,
  readProjectDir,
  readProjectTree,
  writeProjectFiles,
} from '../state/tauriFs';

interface MenuEntry {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  action?: () => void;
  /** Optional per-entry dismiss button (e.g. remove from Open Recent). */
  onRemove?: () => void;
}

type MenuEntryOrBreak = MenuEntry | { kind: 'separator' } | { kind: 'sectionLabel'; label: string };

// Clipboard for Edit > Cut/Copy/Paste (a block, not canvas text).
let clipboard: {
  kind: BlockKind;
  name: string;
  params: Record<string, string | number | boolean>;
  library?: string;
} | null = null;

export function AppMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const [recentTick, setRecentTick] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const modelDoc = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const addBlock = useModelStore((state) => state.addBlock);
  const removeBlock = useModelStore((state) => state.removeBlock);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const undo = useModelStore((state) => state.undo);
  const redo = useModelStore((state) => state.redo);
  const canUndo = useModelStore((state) => state.canUndo);
  const canRedo = useModelStore((state) => state.canRedo);
  const areas = useLayoutStore((state) => state.areas);
  const reopenArea = useLayoutStore((state) => state.reopenArea);
  const toggleCollapse = useLayoutStore((state) => state.toggleCollapse);
  const openPanel = useLayoutStore((state) => state.openPanel);
  const removePanel = useLayoutStore((state) => state.removePanel);
  const openInfo = useUiStore((state) => state.openInfo);
  const openNewProject = useUiStore((state) => state.openNewProject);
  const openFiles = useUiStore((state) => state.openFiles);
  const openBundle = useProjectStore((state) => state.openBundle);
  const bundle = useProjectStore((state) => state.bundle);
  const setPath = useProjectStore((state) => state.setPath);
  const markClean = useProjectStore((state) => state.markClean);

  const selected = (modelDoc?.nodes ?? []).find((node) => node.id === selectedId) ?? null;
  const close = () => setOpen(null);
  // Opening a different model shows its root canvas, not a stale container.
  const openDocument = (document: ModelDocument) => {
    useUiStore.getState().closeAllFiles();
    loadDocument(document);
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(null);
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
      // Not a LogicPilot project: offer to open it as a plain folder anyway
      // so the user can edit code and Save to initialize the project.
      const reason = result.error ?? 'cannot read the project folder';
      const proceed = await new Promise<boolean>((resolve) => {
        useUiStore.getState().openConfirm({
          title: 'Not a LogicPilot project',
          body: `'${dir}' is not a LogicPilot project (${reason}). Open it anyway and edit files? Saving will initialize the project.`,
          actions: [
            { label: 'Open anyway', primary: true, onSelect: () => resolve(true) },
            { label: 'Cancel', onSelect: () => resolve(false) },
          ],
        });
      });
      if (!proceed) {
        return;
      }
      useProjectStore.getState().clearProject();
      useProjectStore.getState().setPath(dir);
      const tree = await readProjectTree(dir);
      if (tree.ok && tree.files) {
        useProjectStore.getState().setDiskFiles(tree.files);
      }
      await useProjectStore.getState().refreshDiskHashes();
      useUiStore.getState().closeAllFiles();
      useCanvasView.getState().resetCanvasViews();
      logConsoleEvent(
        'warn',
        'LP5100: folder is not a LogicPilot project - editing files only until Save initializes it',
      );
      close();
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
      const tree = await readProjectTree(dir);
      if (tree.ok && tree.files) {
        useProjectStore.getState().setDiskFiles(tree.files);
      }
      await useProjectStore.getState().refreshDiskHashes();
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
    void openProjectFromFile(file);
  };
  const fileSave = async () => {
    const projectPath = useProjectStore.getState().path;
    let current = useProjectStore.getState().bundle;
    let model = modelDoc;
    if (!current && projectPath) {
      // A folder opened without logicpilot.json: initialize the project from
      // the in-editor model/main.lp (or the file on disk) on first save.
      const { readProjectFile } = await import('../state/tauriFs');
      const editedMain = useUiStore.getState().diskFiles['model/main.lp'];
      let mainContent = editedMain;
      if (mainContent === undefined) {
        const read = await readProjectFile(projectPath, 'model/main.lp');
        if (read.ok && read.content !== undefined) {
          mainContent = read.content;
        }
      }
      const folderName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Model';
      const initialized = initializeProject(mainContent, folderName);
      model = initialized.document;
      const base = initialized.bundle;
      current = base;
      useProjectStore.getState().openBundle(base);
    }
    const name = model.name || 'Model';
    const saved = saveProject(model, current);
    for (const diagnostic of saved.diagnostics) {
      logConsoleEvent(
        diagnostic.severity === 'error' ? 'error' : 'warn',
        `${diagnostic.code}: ${diagnostic.message}`,
      );
    }
    if (saved.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      openInfo(
        'Save blocked',
        'saving would create ambiguous references, alter model structure, or emit unparseable DSL; fix the model first',
      );
      return;
    }
    const project = saved.bundle;
    const bundle = bundleToJson(project);
    if (projectPath) {
      // Detect external edits since the project was opened (LP5xxx): never
      // silently overwrite a file that changed on disk.
      const { readProjectHashes } = await import('../state/tauriFs');
      const baseline = useProjectStore.getState().diskHashes;
      const currentHashes = await readProjectHashes(projectPath);
      if (currentHashes.ok && currentHashes.hashes && baseline) {
        const changed = Object.keys(baseline).filter(
          (path) => baseline[path] !== currentHashes.hashes![path],
        );
        if (changed.length > 0) {
          for (const path of changed.slice(0, 3)) {
            logConsoleEvent('warn', `LP5001: '${path}' changed on disk`);
          }
          const proceed = await new Promise<boolean>((resolve) => {
            useUiStore.getState().openConfirm({
              title: 'Files changed on disk',
              body: `${changed.length} file(s) changed outside the IDE (${changed
                .slice(0, 3)
                .join(', ')}...). Saving will overwrite them. Continue?`,
              actions: [
                { label: 'Overwrite', primary: true, onSelect: () => resolve(true) },
                { label: 'Cancel', onSelect: () => resolve(false) },
              ],
            });
          });
          if (!proceed) {
            return;
          }
        }
      }
      const result = await writeProjectFiles(projectPath, projectToDiskFiles(project));
      if (!result.ok) {
        openInfo('Save failed', result.error ?? 'cannot write the project folder');
        return;
      }
      await useProjectStore.getState().refreshDiskHashes();
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
  // File > Close: close the current project. With unsaved changes, ask
  // whether to save first (Save / Don't Save / Cancel).
  const fileClose = () => {
    const { bundle: current, dirty: isDirty } = useProjectStore.getState();
    const projectName = current?.manifest.name ?? 'Model';
    const doClose = () => {
      useUiStore.getState().closeAllFiles();
      useCanvasView.getState().resetCanvasViews();
      useModelStore.getState().reset();
      useProjectStore.getState().clearProject();
      useProjectStore.getState().setPath(null);
      useProjectStore.getState().setDiskFiles(null);
      // Back to the welcome tab when it is open, else a blank center.
      if (useLayoutStore.getState().areas.center.panels.includes('welcome')) {
        useLayoutStore.getState().setActive('center', 'welcome');
      }
      close();
    };
    if (current && isDirty) {
      useUiStore.getState().openConfirm({
        title: 'Close project',
        body: `Close "${projectName}"? Your changes will be lost if you do not save.`,
        actions: [
          {
            label: 'Save',
            primary: true,
            onSelect: () => {
              void fileSave().then(() => {
                useProjectStore.getState().markClean();
                doClose();
              });
            },
          },
          { label: "Don't Save", onSelect: doClose },
          { label: 'Cancel', onSelect: () => useUiStore.getState().closeConfirm() },
        ],
      });
      return;
    }
    doClose();
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
    const areaState = areas[area];
    // The check mark means "this panel is open", not "focused". The left area
    // shows one panel at a time, so clicking the open one collapses the whole
    // area; the right area is a tab strip, so clicking an open tab removes
    // just that panel (AI and Properties can stay side by side in tabs).
    if (area === 'left') {
      const isOpen = !areaState.collapsed && areaState.activePanel === panel;
      if (isOpen) {
        toggleCollapse('left');
      } else {
        if (areaState.collapsed) {
          reopenArea('left', areaState.size || 280);
        }
        openPanel('left', panel);
      }
      close();
      return;
    }
    const isOpen = !areaState.collapsed && areaState.panels.includes(panel);
    if (isOpen) {
      const remaining = areaState.panels.filter((entry) => entry !== panel);
      if (remaining.length === 0) {
        toggleCollapse('right');
      } else {
        removePanel('right', panel);
      }
    } else {
      if (areaState.collapsed) {
        reopenArea('right', areaState.size || 360);
      }
      openPanel('right', panel);
    }
    close();
  };
  const showConsole = () => {
    toggleCollapse('bottom');
    close();
  };

  const recent = loadRecent();
  const renderEntry = (entry: MenuEntry, key: string) => (
    <div key={key} className={`app-menu-entry-row${entry.disabled ? ' disabled' : ''}`}>
      <button
        className={`app-menu-entry${entry.checked ? ' checked' : ''}${entry.onRemove ? ' has-remove' : ''}`}
        disabled={entry.disabled}
        onClick={entry.action}
      >
        <span className="app-menu-entry-label">{entry.label}</span>
        {entry.shortcut && <span className="app-menu-entry-shortcut">{entry.shortcut}</span>}
        {entry.checked && <span className="app-menu-entry-check">✓</span>}
      </button>
      {entry.onRemove && (
        <button
          className="app-menu-entry-remove"
          type="button"
          title="Remove from recent"
          aria-label={`Remove ${entry.label} from recent`}
          onClick={(event) => {
            event.stopPropagation();
            entry.onRemove?.();
          }}
        >
          ✕
        </button>
      )}
    </div>
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
              onRemove: () => {
                removeRecent(model.name);
                setRecentTick((tick) => tick + 1);
              },
            }))
          : [{ label: 'No recent models', disabled: true as const, action: undefined }]),
        { kind: 'separator' },
        { label: 'Save', shortcut: 'Ctrl+S', action: fileSave },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: fileSave },
        { kind: 'separator' },
        { label: 'Close', disabled: !bundle, action: fileClose },
        { kind: 'separator' },
        { label: 'Exit', action: exitApp },
      ],
    },
    {
      label: 'Edit',
      entries: [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !canUndo,
          action: () => {
            undo();
            close();
          },
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Shift+Z',
          disabled: !canRedo,
          action: () => {
            redo();
            close();
          },
        },
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
          checked: !areas.left.collapsed && areas.left.activePanel === 'explorer',
          action: () => showPanel('left', 'explorer'),
        },
        {
          label: 'Project',
          checked: !areas.left.collapsed && areas.left.activePanel === 'modelInfo',
          action: () => showPanel('left', 'modelInfo'),
        },
        {
          label: 'Palette',
          checked: !areas.left.collapsed && areas.left.activePanel === 'palette',
          action: () => showPanel('left', 'palette'),
        },
        {
          label: 'Properties',
          checked: !areas.right.collapsed && areas.right.panels.includes('properties'),
          action: () => showPanel('right', 'properties'),
        },
        {
          label: 'AI',
          checked: !areas.right.collapsed && areas.right.panels.includes('ai'),
          action: () => showPanel('right', 'ai'),
        },
        {
          label: 'DSL',
          // Code tabs are per file; the DSL panel counts as open when any
          // file tab exists. Clicking it again closes every file tab.
          checked: openFiles.length > 0,
          action: () => {
            if (useUiStore.getState().openFiles.length > 0) {
              useUiStore.getState().closeAllFiles();
            } else {
              const modelPath = useProjectStore.getState().bundle?.manifest.model;
              if (modelPath) {
                useUiStore.getState().openFile(modelPath);
              } else {
                // A bare folder: open model/main.lp from disk read-only if
                // present so code editing is possible before Save initializes.
                const dir = useProjectStore.getState().path;
                const diskFiles = useProjectStore.getState().diskFiles;
                if (dir && diskFiles?.includes('model/main.lp')) {
                  void import('../state/tauriFs').then(async ({ readProjectFile }) => {
                    const read = await readProjectFile(dir, 'model/main.lp');
                    if (read.ok && read.content !== undefined) {
                      useUiStore.getState().openDiskFile('model/main.lp', read.content);
                    }
                  });
                }
              }
              useLayoutStore.getState().openPanel('center', 'dsl');
            }
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
            // The welcome page is a closable center tab.
            useLayoutStore.getState().openPanel('center', 'welcome');
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
                return renderEntry(entry, `${menu.label}-${index}-${recentTick}`);
              })}
            </div>
          )}
        </div>
      ))}
      <input ref={fileRef} type="file" accept=".lpproj,.lp,.json" hidden onChange={onFileChosen} />
    </nav>
  );
}
