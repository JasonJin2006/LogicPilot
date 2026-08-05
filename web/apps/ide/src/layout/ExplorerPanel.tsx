// Side panel (Explorer view): the project's file tree. Source files come
// from the open *.lpproj bundle; build/ and results/ are derived-artifact
// folders. Right-click on a folder creates a file, on a file renames or
// deletes it - all edits update the bundle in place (the Project panel
// re-parses the changed DSL automatically) and mark the project dirty.

import { useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FileJson2, Folder, FolderOpen } from 'lucide-react';
import { sceneContainerFromFile } from '../project/project';
import { openProjectFromFile } from '../project/openProject';
import { useCanvasView } from '../state/canvasView';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
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
  return roots;
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
  const dirty = useProjectStore((state) => state.dirty);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const openDslEditor = useUiStore((state) => state.openDslEditor);
  const setCanvasView = useCanvasView((state) => state.setView);
  const activePath = useUiStore((state) => state.dslEditorFile);
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextAction[] } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleFolder = (path: string) =>
    setCollapsed((current) => ({ ...current, [path]: !(current[path] === true) }));

  // No project open: an empty panel with a single action instead of a tree.
  if (!bundle) {
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

  const rootName = bundle.manifest.name;
  const sourceFolders = treeFromPaths(Object.keys(bundle.files));

  const newFile = (dir: string) => {
    openPrompt({
      title: 'New file',
      label: 'file name',
      initial: 'new.lp',
      submitLabel: 'Create',
      onSubmit: (name) => {
        const path = dir === '' ? name : `${dir}/${name}`;
        const stem = name.replace(/\.lp$/, '');
        const content = path.endsWith('.lp') ? `model ${stem} {\n}\n` : '';
        updateFiles((files) => ({ ...files, [path]: content }));
      },
    });
  };

  const renameFile = (path: string, name: string) => {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    openPrompt({
      title: 'Rename file',
      label: 'file name',
      initial: name,
      submitLabel: 'Rename',
      onSubmit: (value) =>
        updateFiles((files) => {
          const next = { ...files };
          const content = next[path] ?? '';
          delete next[path];
          next[`${dir}${value}`] = content;
          return next;
        }),
    });
  };

  const deleteFileRow = (path: string) =>
    updateFiles((files) => {
      const next = { ...files };
      delete next[path];
      return next;
    });

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
    if (path !== null) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const source = bundle.files[path];
      const scene = source !== undefined ? sceneContainerFromFile(path, source) : null;
      if (scene) {
        actions.push({
          label: 'Open in DSL',
          onSelect: () => openDslEditor(path),
        });
      }
      actions.push({ label: 'Rename...', onSelect: () => renameFile(path, name) });
      actions.push({
        label: 'Delete',
        danger: true,
        onSelect: () => deleteFileRow(path),
      });
    } else if (dir !== null) {
      actions.push({ label: 'New file...', onSelect: () => newFile(dir) });
    }
    if (actions.length > 0) {
      setMenu({ x: event.clientX, y: event.clientY, actions });
    }
  };

  const onFileOpen = (event: MouseEvent<HTMLDivElement>) => {
    if (!bundle) {
      return;
    }
    const row = (event.target as Element).closest('.tree-row');
    const path = row?.getAttribute('data-path');
    if (path !== null && path !== undefined) {
      const source = bundle.files[path];
      const scene = source !== undefined ? sceneContainerFromFile(path, source) : null;
      if (scene) {
        // A scene file IS a container Node: clicking it opens its canvas.
        setCanvasView(scene);
      } else {
        openDslEditor(path);
      }
    }
  };

  return (
    <div
      className="side-panel-body explorer-panel"
      onClick={onFileOpen}
      onContextMenu={onContextMenu}
    >
      <div className="tree-row tree-root">
        <span className="tree-glyph">
          {bundle ? <FolderOpen size={13} /> : <Folder size={13} />}
        </span>
        <span className="tree-label">{rootName}</span>
        {bundle && dirty && <span className="tree-dirty-dot" title="unsaved changes" />}
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
      {ARTIFACT_ROWS.map((entry) => (
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
