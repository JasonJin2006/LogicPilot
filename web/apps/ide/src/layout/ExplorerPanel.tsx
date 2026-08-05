// Side panel (Explorer view): the project's file tree. The source files
// (model DSL + canvas presentation) come from the open *.lpproj bundle when
// one is loaded, otherwise they are derived from the live canvas document.
// build/ and results/ are derived-artifact folders that the CLI materializes
// (docs/specs/project-format.md).

import { FileCode2, FileJson2, Folder, FolderOpen } from 'lucide-react';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';

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

function FileRow({ file, indent }: { file: TreeFile; indent: number }) {
  const Icon = file.kind === 'dsl' ? FileCode2 : FileJson2;
  const muted = file.kind === 'muted' || file.kind === 'ir';
  return (
    <div className="tree-row tree-file" style={{ paddingLeft: indent * 14 + 8 }} title={file.path}>
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

function FolderRow({ folder, indent }: { folder: TreeFolder; indent: number }) {
  return (
    <>
      <div
        className={`tree-row tree-folder${folder.muted ? ' tree-muted' : ''}`}
        style={{ paddingLeft: indent * 14 + 8 }}
        title={folder.path}
      >
        <span className="tree-glyph">
          <Folder size={12} />
        </span>
        <span className="tree-label">{folder.name}</span>
      </div>
      {folder.children.map((child) =>
        isFolder(child) ? (
          <FolderRow key={child.path} folder={child} indent={indent + 1} />
        ) : (
          <FileRow key={child.path} file={child} indent={indent + 1} />
        ),
      )}
    </>
  );
}

export function ExplorerPanel() {
  const modelDoc = useModelStore((state) => state.document);
  const bundle = useProjectStore((state) => state.bundle);
  const dirty = useProjectStore((state) => state.dirty);
  const projectPath = useProjectStore((state) => state.path);

  const rootName = bundle ? bundle.manifest.name : `${modelDoc.name || 'Model'} (unsaved)`;
  const sourceRows: TreeEntry[] = bundle
    ? Object.keys(bundle.files)
        .sort()
        .map((path) => {
          const name = path.slice(path.lastIndexOf('/') + 1);
          return {
            name,
            path,
            kind: path.endsWith('.lp') ? ('dsl' as const) : ('json' as const),
          };
        })
    : [
        {
          name: 'main.lp',
          path: 'model/main.lp',
          kind: 'dsl' as const,
        },
        {
          name: 'main.canvas.json',
          path: 'presentation/main.canvas.json',
          kind: 'json' as const,
        },
      ];

  return (
    <div className="side-panel-body explorer-panel">
      <div className="tree-row tree-root">
        <span className="tree-glyph">
          {bundle ? <FolderOpen size={13} /> : <Folder size={13} />}
        </span>
        <span className="tree-label">{rootName}</span>
        {bundle && dirty && (
          <span className="tree-dirty-dot" title="unsaved changes" />
        )}
      </div>
      {sourceRows.map((entry) =>
        isFolder(entry) ? (
          <FolderRow key={entry.path} folder={entry} indent={1} />
        ) : (
          <FileRow key={entry.path} file={entry} indent={1} />
        ),
      )}
      {ARTIFACT_ROWS.map((entry) => (
        <FolderRow key={entry.path} folder={entry} indent={1} />
      ))}
      <div className="side-hint">
        {bundle
          ? projectPath
            ? `工程目录：${projectPath}`
            : `已保存工程（${Object.keys(bundle.files).length} 个源文件）`
          : '尚未保存为工程；File > Save 生成 .lpproj'}
      </div>
    </div>
  );
}
