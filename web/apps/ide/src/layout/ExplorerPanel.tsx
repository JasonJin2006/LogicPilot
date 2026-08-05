// Side panel (Explorer view): the project's file tree. Source files come
// from the open *.lpproj bundle; build/ and results/ are derived-artifact
// folders. Right-click on a folder creates a file, on a file renames or
// deletes it - all edits update the bundle in place (the Project panel
// re-parses the changed DSL automatically) and mark the project dirty.

import { useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Minimize2,
  RefreshCw,
} from 'lucide-react';
import { sceneContainerFromFile } from '../project/project';
import { DEFAULT_MODEL_PATH } from '../project/project';
import { openProjectFromFile } from '../project/openProject';
import { useCanvasView } from '../state/canvasView';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import {
  createDirectory,
  deleteProjectEntry,
  readProjectFile,
  renameProjectEntry,
  writeProjectFile,
} from '../state/tauriFs';
import { ContextMenu } from './ContextMenu';
import type { ContextAction } from './ContextMenu';

interface TreeFile {
  name: string;
  path: string;
  kind: 'dsl' | 'json' | 'ir' | 'muted';
}

interface TreeFolder {
  name: string;
  path: string;
  muted?: boolean;
  children: TreeEntry[];
}

type TreeEntry = TreeFile | TreeFolder;

const ARTIFACT_ROWS: TreeFolder[] = [
  {
    name: 'build',
    path: 'build/',
    muted: true,
    children: [
      { name: 'main.lpir', path: 'build/main.lpir', kind: 'ir' },
      { name: 'schema.sha256', path: 'build/schema.sha256', kind: 'muted' },
    ],
  },
  {
    name: 'results',
    path: 'results/',
    muted: true,
    children: [{ name: '(empty)', path: 'results/', kind: 'muted' }],
  },
];

function isFolder(entry: TreeEntry): entry is TreeFolder {
  return 'children' in entry;
}

// Group flat project paths into a nested folder tree (model/main.lp ->
// model/ > main.lp).
function treeFromPaths(paths: string[]): TreeFolder[] {
  const roots: TreeFolder[] = [];
  for (const path of [...paths].sort()) {
    const parts = path.split('/');
    let level: TreeEntry[] = roots;
    for (let i = 0; i < parts.length; ++i) {
      const name = parts[i]!;
      const isFile = i === parts.length - 1;
      const existing = level.find((entry) => entry.name === name);
      if (isFile) {
        if (existing === undefined) {
          level.push({
            name,
            path,
            kind: path.endsWith('.lp') ? ('dsl' as const) : ('json' as const),
          });
        }
        break;
      }
      if (existing !== undefined && isFolder(existing)) {
        level = existing.children;
        continue;
      }
      const folder: TreeFolder = {
        name,
        path: parts.slice(0, i + 1).join('/'),
        children: [],
      };
      level.push(folder);
      level = folder.children;
    }
  }
  sortEntries(roots);
  return roots;
}

// VS Code ordering: folders first, then files, each by name.
function sortEntries(entries: TreeEntry[]): void {
  entries.sort((a, b) => {
    const aFolder = isFolder(a) ? 0 : 1;
    const bFolder = isFolder(b) ? 0 : 1;
    if (aFolder !== bFolder) {
      return aFolder - bFolder;
    }
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (isFolder(entry)) {
      sortEntries(entry.children);
    }
  }
}

function FileRow({
  file,
  indent,
  dataPath,
  active,
}: {
  file: TreeFile;
  indent: number;
  dataPath?: string;
  active?: boolean;
}) {
  const Icon = file.kind === 'dsl' ? FileCode2 : FileJson2;
  const muted = file.kind === 'muted' || file.kind === 'ir';
  return (
    <div
      className={`tree-row tree-file${active ? ' tree-active' : ''}`}
      style={{ paddingLeft: indent * 14 + 8, '--depth': indent } as CSSProperties}
      title={file.path}
      data-path={dataPath}
    >
      {file.kind === 'ir' || file.kind === 'muted' ? (
        <span className="tree-glyph tree-glyph-muted">·</span>
      ) : (
        <span className="tree-glyph">
          <Icon size={12} />
        </span>
      )}
      <span className={`tree-label${muted ? ' tree-muted' : ''}`}>{file.name}</span>
    </div>
  );
}

function FolderRow({
  folder,
  indent,
  dataDir,
  collapsed,
  activePath,
  onToggle,
}: {
  folder: TreeFolder;
  indent: number;
  dataDir?: string;
  collapsed: Record<string, boolean>;
  activePath: string | null;
  onToggle: (path: string) => void;
}) {
  const open = collapsed[folder.path] !== true;
  return (
    <>
      <div
        className={`tree-row tree-folder${folder.muted ? ' tree-muted' : ''}`}
        style={{ paddingLeft: indent * 14 + 8, '--depth': indent } as CSSProperties}
        title={folder.path}
        data-dir={dataDir}
        onClick={() => onToggle(folder.path)}
      >
        <span className="tree-glyph">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="tree-glyph">{open ? <FolderOpen size={12} /> : <Folder size={12} />}</span>
        <span className="tree-label">{folder.name}</span>
      </div>
      {open &&
        folder.children.map((child) =>
          isFolder(child) ? (
            <FolderRow
              key={child.path}
              folder={child}
              indent={indent + 1}
              dataDir={child.muted ? undefined : child.path}
              collapsed={collapsed}
              activePath={activePath}
              onToggle={onToggle}
            />
          ) : (
            <FileRow
              key={child.path}
              file={child}
              indent={indent + 1}
              dataPath={child.kind === 'muted' || child.kind === 'ir' ? undefined : child.path}
              active={child.path === activePath}
            />
          ),
        )}
    </>
  );
}

export function ExplorerPanel() {
  const bundle = useProjectStore((state) => state.bundle);
  const projectPath = useProjectStore((state) => state.path);
  const diskFiles = useProjectStore((state) => state.diskFiles);
  const refreshDiskTree = useProjectStore((state) => state.refreshDiskTree);
  const dirty = useProjectStore((state) => state.dirty);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const openInfo = useUiStore((state) => state.openInfo);
  const openFile = useUiStore((state) => state.openFile);
  const setCanvasView = useCanvasView((state) => state.setView);
  const activePath = useUiStore((state) => state.activeFile);
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextAction[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleFolder = (path: string) =>
    setCollapsed((current) => ({ ...current, [path]: !(current[path] === true) }));
  const isDisk = projectPath !== null && diskFiles !== null;

  // No project and no folder open: an empty panel with a single action.
  if (!bundle && !diskFiles) {
    return (
      <div className="side-panel-body explorer-panel">
        <div className="explorer-empty">
          <button
            type="button"
            className="explorer-empty-open"
            onClick={() => fileInputRef.current?.click()}
          >
            Open Project...
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".lpproj,.lp,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) {
                void openProjectFromFile(file);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // A bare folder opened without logicpilot.json still browses its files
  // (code editing works; Save initializes the project).
  const rootName = bundle
    ? bundle.manifest.name
    : (projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? 'Folder');
  // With an on-disk project the Explorer is a real workspace file browser
  // (the disk tree, including derived folders); otherwise it shows the
  // in-memory bundle files.
  const sourceFolders = diskFiles
    ? treeFromPaths(diskFiles)
    : treeFromPaths(Object.keys(bundle?.files ?? {}));

  const newFile = (dir: string) => {
    openPrompt({
      title: 'New file',
      label: 'file name',
      initial: 'new.lp',
      submitLabel: 'Create',
      onSubmit: (name) => {
        const path = dir === '' ? name : `${dir}/${name}`;
        if (isDisk && projectPath) {
          const content = path.endsWith('.lp')
            ? `model ${name.replace(/\.lp$/, '')} {\n}\n`
            : '';
          void writeProjectFile(projectPath, path, content).then((result) => {
            if (!result.ok) {
              openInfo('Create failed', result.error ?? 'cannot create the file');
            }
            void refreshDiskTree();
          });
          return;
        }
        updateFiles((files) => ({
          ...files,
          [path]: path.endsWith('.lp')
            ? `model ${name.replace(/\.lp$/, '')} {\n}\n`
            : '',
        }));
      },
    });
  };

  const newFolder = (dir: string) => {
    if (!isDisk || !projectPath) {
      return;
    }
    openPrompt({
      title: 'New folder',
      label: 'folder name',
      initial: 'new-folder',
      submitLabel: 'Create',
      onSubmit: (name) => {
        const path = dir === '' ? name : `${dir}/${name}`;
        void createDirectory(projectPath, path).then((result) => {
          if (!result.ok) {
            openInfo('Create failed', result.error ?? 'cannot create the folder');
          }
          void refreshDiskTree();
        });
      },
    });
  };

  const renameEntry = (path: string, isDir: boolean) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    openPrompt({
      title: isDir ? 'Rename folder' : 'Rename file',
      label: isDir ? 'folder name' : 'file name',
      initial: name,
      submitLabel: 'Rename',
      onSubmit: (value) => {
        const next = `${dir}${value}`;
        if (isDisk && projectPath) {
          void renameProjectEntry(projectPath, path, next).then((result) => {
            if (!result.ok) {
              openInfo('Rename failed', result.error ?? 'cannot rename');
              return;
            }
            // Keep the bundle file map in sync when bundle files were moved.
            updateFiles((files) => {
              const mapped = { ...files };
              if (isDir) {
                const prefix = `${path}/`;
                for (const key of Object.keys(mapped)) {
                  if (key.startsWith(prefix)) {
                    mapped[`${next}/${key.slice(prefix.length)}`] = mapped[key]!;
                    delete mapped[key];
                  }
                }
              } else if (mapped[path] !== undefined) {
                mapped[next] = mapped[path]!;
                delete mapped[path];
              }
              // A scene rename must also rewrite its instance reference in
              // the parent model file (project-format-v2 §6).
              if (!isDir && path.startsWith('model/scenes/')) {
                const main = mapped[DEFAULT_MODEL_PATH];
                if (main !== undefined) {
                  mapped[DEFAULT_MODEL_PATH] = main.split(`"${path}"`).join(`"${next}"`);
                }
              }
              return mapped;
            });
            void refreshDiskTree();
          });
          return;
        }
        if (isDir) {
          return; // in-memory bundles have no empty folders
        }
        updateFiles((files) => {
          const nextFiles = { ...files };
          const content = nextFiles[path] ?? '';
          delete nextFiles[path];
          nextFiles[next] = content;
          return nextFiles;
        });
      },
    });
  };

  const deleteEntry = (path: string, isDir: boolean) => {
    if (isDisk && projectPath) {
      void deleteProjectEntry(projectPath, path).then((result) => {
        if (!result.ok) {
          openInfo('Delete failed', result.error ?? 'cannot delete');
          return;
        }
        updateFiles((files) => {
          const next = { ...files };
          if (isDir) {
            const prefix = `${path}/`;
            for (const key of Object.keys(next)) {
              if (key.startsWith(prefix)) {
                delete next[key];
              }
            }
          } else {
            delete next[path];
          }
          return next;
        });
        void refreshDiskTree();
      });
      return;
    }
    if (!isDir) {
      updateFiles((files) => {
        const next = { ...files };
        delete next[path];
        return next;
      });
    }
  };

  const collectFolders = (entries: TreeEntry[]): string[] =>
    entries.flatMap((entry) =>
      isFolder(entry) ? [entry.path, ...collectFolders(entry.children)] : [],
    );
  const collapseAll = () => {
    setCollapsed(
      Object.fromEntries(collectFolders(sourceFolders).map((path) => [path, true])),
    );
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!bundle) {
      return;
    }
    const row = (event.target as Element).closest('.tree-row');
    if (!row) {
      return;
    }
    const path = row.getAttribute('data-path');
    const dir = row.getAttribute('data-dir');
    const actions: ContextAction[] = [];
    if (path !== null && path !== undefined) {
      const source = bundle.files[path];
      const scene = source !== undefined ? sceneContainerFromFile(path, source) : null;
      if (scene) {
        actions.push({
          label: 'Open in DSL',
          onSelect: () => openFile(path),
        });
      }
      actions.push({ label: 'Rename...', onSelect: () => renameEntry(path, false) });
      actions.push({
        label: 'Delete',
        danger: true,
        onSelect: () => deleteEntry(path, false),
      });
    } else if (dir !== null && dir !== undefined) {
      const isRoot = dir === '';
      actions.push({ label: 'New file...', onSelect: () => newFile(dir) });
      if (isDisk) {
        actions.push({ label: 'New folder...', onSelect: () => newFolder(dir) });
        if (!isRoot) {
          actions.push({ label: 'Rename...', onSelect: () => renameEntry(dir, true) });
          actions.push({
            label: 'Delete',
            danger: true,
            onSelect: () => deleteEntry(dir, true),
          });
        }
      }
    }
    if (actions.length > 0) {
      setMenu({ x: event.clientX, y: event.clientY, actions });
    }
  };

  const onFileOpen = (event: MouseEvent<HTMLDivElement>) => {
    const row = (event.target as Element).closest('.tree-row');
    const path = row?.getAttribute('data-path');
    if (path !== null && path !== undefined) {
      const source = bundle?.files[path];
      const scene = source !== undefined ? sceneContainerFromFile(path, source) : null;
      if (scene) {
        // A scene file IS a container Node: clicking it opens its canvas.
        setCanvasView(scene);
      } else if (source !== undefined) {
        openFile(path);
      } else {
        // A disk file outside the bundle: view it read-only from disk.
        if (projectPath) {
          void readProjectFile(projectPath, path).then((result) => {
            if (result.ok && result.content !== undefined) {
              useUiStore.getState().openDiskFile(path, result.content);
            }
          });
        } else {
          openFile(path);
        }
      }
    }
  };

  return (
    <div
      className="side-panel-body explorer-panel"
      onClick={onFileOpen}
      onContextMenu={onContextMenu}
    >
      <div className="tree-row tree-root" data-dir="">
        <span className="tree-glyph">
          {bundle ? <FolderOpen size={13} /> : <Folder size={13} />}
        </span>
        <span className="tree-label">{rootName}</span>
        {bundle && dirty && <span className="tree-dirty-dot" title="unsaved changes" />}
        <span className="tree-actions">
          <button
            type="button"
            title="New file"
            onClick={(event) => {
              event.stopPropagation();
              newFile('');
            }}
          >
            <FilePlus size={12} />
          </button>
          {isDisk && (
            <button
              type="button"
              title="New folder"
              onClick={(event) => {
                event.stopPropagation();
                newFolder('');
              }}
            >
              <FolderPlus size={12} />
            </button>
          )}
          <button
            type="button"
            title="Refresh"
            onClick={(event) => {
              event.stopPropagation();
              void refreshDiskTree();
            }}
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            title="Collapse all"
            onClick={(event) => {
              event.stopPropagation();
              collapseAll();
            }}
          >
            <Minimize2 size={12} />
          </button>
        </span>
      </div>
      {sourceFolders.map((entry) => (
        <FolderRow
          key={entry.path}
          folder={entry}
          indent={1}
          dataDir={entry.path}
          collapsed={collapsed}
          activePath={activePath}
          onToggle={toggleFolder}
        />
      ))}
      {!diskFiles &&
        ARTIFACT_ROWS.map((entry) => (
          <FolderRow
            key={entry.path}
            folder={entry}
            indent={1}
            collapsed={collapsed}
            activePath={activePath}
            onToggle={toggleFolder}
          />
        ))}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
