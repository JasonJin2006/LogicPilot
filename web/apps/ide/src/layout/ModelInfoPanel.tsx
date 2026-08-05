// Side panel (Project view): the project's CODE structure, split across the
// per-concern model files. The main model file renders as a model node with
// its direct members; the model part fragments (resources/process/agents/
// experiments) render as their block trees. Right-click adds/renames/deletes
// elements in the owning file, rewriting the DSL text in place; the canvas is
// best-effort reloaded from the merged source. Files that do not parse show
// as orphan rows.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson2,
  FileX2,
  FolderOpen,
} from 'lucide-react';
import { parseDsl } from '@logicpilot/editor';
import {
  DEFAULT_MODEL_PATH,
  mergeModelSource,
} from '../project/project';
import { useModelStore } from '../state/modelStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { ContextMenu } from './ContextMenu';
import type { ContextAction } from './ContextMenu';
import {
  MODEL_ADD_KINDS,
  STAGE_ADD_KINDS,
  deleteSpan,
  insertMember,
  parseProjectMembers,
  parseProjectSource,
  replaceSpan,
} from '../project/projectTree';
import type { ProjectMember, ProjectModel } from '../project/projectTree';

type PanelFile =
  | { type: 'model'; path: string; source: string; model: ProjectModel }
  | { type: 'part'; path: string; source: string; members: ProjectMember[] }
  | { type: 'orphan'; path: string; error: string }
  | { type: 'other'; path: string };

interface MenuState {
  x: number;
  y: number;
  actions: ContextAction[];
}

const PART_KIND_BY_PATH: Record<string, string> = {
  'model/resources.lp': 'resource',
  'model/process.lp': 'process',
  'model/agents.lp': 'agent',
  'model/experiments.lp': 'experiment',
};

const PART_PATH_BY_KIND: Record<string, string> = {
  resource: 'model/resources.lp',
  process: 'model/process.lp',
  agent: 'model/agents.lp',
  experiment: 'model/experiments.lp',
};

function countBlocks(members: ProjectMember[], kind: string): number {
  return members.filter((member) => !member.isLeaf && member.kind === kind).length;
}

export function ModelInfoPanel() {
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const document = useModelStore((state) => state.document);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const mainPath = bundle?.manifest.model ?? DEFAULT_MODEL_PATH;
  const partPaths = bundle?.manifest.modelParts ?? [];

  const entries = useMemo<PanelFile[]>(() => {
    if (!bundle) {
      return [];
    }
    return Object.keys(bundle.files)
      .sort()
      .map((path): PanelFile => {
        const source = bundle.files[path]!;
        if (!path.endsWith('.lp')) {
          return { type: 'other', path };
        }
        if (partPaths.includes(path)) {
          const parsed = parseProjectMembers(source);
          if (!parsed.ok) {
            return { type: 'orphan', path, error: parsed.error ?? 'invalid fragment' };
          }
          return { type: 'part', path, source, members: parsed.members ?? [] };
        }
        const parsed = parseProjectSource(source);
        if (!parsed.ok) {
          return { type: 'orphan', path, error: parsed.error ?? 'invalid DSL' };
        }
        return { type: 'model', path, source, model: parsed.model! };
      });
  }, [bundle, partPaths]);

  const toggle = (key: string) =>
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  const isCollapsed = (key: string) => collapsed[key] === true;
  const showMenu = (x: number, y: number, actions: ContextAction[]) =>
    setMenu({ x, y, actions });

  const syncCanvas = () => {
    const current = useProjectStore.getState().bundle;
    if (!current) {
      return;
    }
    const merged = mergeModelSource(
      current.files[current.manifest.model] ?? '',
      current.files,
      current.manifest.modelParts ?? [],
    );
    const canvas = parseDsl(merged);
    if (canvas.ok) {
      loadDocument(canvas.document);
    }
  };

  const commitEdit = (path: string, apply: (source: string) => string) => {
    const current = useProjectStore.getState().bundle;
    if (!current) {
      return;
    }
    const source = current.files[path] ?? '';
    const next = apply(source);
    updateFiles((files) => ({ ...files, [path]: next }));
    syncCanvas();
  };

  const deleteFile = (path: string) => {
    updateFiles((files) => {
      const next = { ...files };
      delete next[path];
      return next;
    });
  };

  // Insert a new block. `container` is either the model (main file) or a
  // block inside a part file; `depth` is the container's nesting depth.
  const addBlock = (
    path: string,
    container: { bodyClose: number } | null,
    depth: number,
    kind: string,
    template: (name: string) => string,
  ) => {
    const current = useProjectStore.getState().bundle;
    if (!current) {
      return;
    }
    const targetPart = PART_PATH_BY_KIND[kind];
    if (container === null && targetPart !== undefined) {
      // Add at the model level -> route to the per-concern part file.
      const partSource = current.files[targetPart] ?? '';
      const parsedPart = parseProjectMembers(partSource);
      const siblings = parsedPart.ok ? (parsedPart.members ?? []) : [];
      const name = `${kind}${countBlocks(siblings, kind) + 1}`;
      const block = insertMember(partSource, partSource.length, '  ', template(name));
      updateFiles((files) => ({ ...files, [targetPart]: block }));
      syncCanvas();
      return;
    }
    // Insert into the model body (main file) or a block body.
    const source = current.files[path] ?? '';
    let siblings: ProjectMember[] = [];
    let insertAt = source.length;
    if (container === null) {
      const parsed = parseProjectSource(source);
      if (parsed.ok && parsed.model) {
        siblings = parsed.model.members;
        insertAt = parsed.model.bodyClose;
      }
    } else {
      siblings = findChildren(source, container.bodyClose);
      insertAt = container.bodyClose;
    }
    const name = `${kind}${countBlocks(siblings, kind) + 1}`;
    commitEdit(path, (src) =>
      insertMember(src, insertAt, '  '.repeat(depth + 1), template(name)),
    );
  };

  const renameBlock = (
    path: string,
    nameSpan: { start: number; end: number },
    currentName: string,
  ) => {
    openPrompt({
      title: 'Rename',
      label: 'name',
      initial: currentName,
      submitLabel: 'Rename',
      onSubmit: (value) =>
        commitEdit(path, (src) => replaceSpan(src, nameSpan.start, nameSpan.end, value)),
    });
  };

  const deleteBlock = (path: string, span: { start: number; end: number }) => {
    commitEdit(path, (src) => deleteSpan(src, span.start, span.end));
  };

  const renderMembers = (
    members: ProjectMember[],
    path: string,
    depth: number,
  ): ReactNode =>
    members
      .filter((member) => !member.isLeaf)
      .map((member) => renderMember(member, path, depth));

  const renderMember = (
    member: ProjectMember,
    path: string,
    depth: number,
  ): ReactNode => {
    const key = `${path}:${member.kind}:${member.name}`;
    const open = !isCollapsed(key);
    const hasChildren = member.children.length > 0;
    const actions: ContextAction[] = [];
    if (member.kind === 'process') {
      for (const stage of STAGE_ADD_KINDS) {
        actions.push({
          label: `Add ${stage.kind}`,
          onSelect: () => addBlock(path, member, depth, stage.kind, stage.template),
        });
      }
    } else if (member.kind === 'agent') {
      const agent = MODEL_ADD_KINDS.find((entry) => entry.kind === 'agent')!;
      actions.push({
        label: 'Add agent',
        onSelect: () => addBlock(path, member, depth, 'agent', agent.template),
      });
    }
    actions.push({
      label: 'Rename',
      onSelect: () => renameBlock(path, member.nameSpan!, member.name),
    });
    actions.push({
      label: 'Delete',
      danger: true,
      onSelect: () => deleteBlock(path, member.span),
    });
    return (
      <div key={key}>
        <div
          className="tree-row tree-file"
          style={{ paddingLeft: (depth + 1) * 14 + 8 }}
          title={`${member.kind} ${member.name}`}
          onClick={hasChildren ? () => toggle(key) : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(event.clientX, event.clientY, actions);
          }}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span className="tree-glyph tree-glyph-muted">·</span>
          )}
          <span className="outline-kind">{member.kind}</span>
          <span className="outline-name">{member.name}</span>
        </div>
        {open && hasChildren && renderMembers(member.children, path, depth + 1)}
      </div>
    );
  };

  const renderModelNode = (
    path: string,
    source: string,
    model: ProjectModel,
  ): ReactNode => {
    const key = `${path}#model`;
    const open = !isCollapsed(key);
    const actions: ContextAction[] = [
      ...MODEL_ADD_KINDS.map(({ kind, template }) => ({
        label: `Add ${kind}`,
        onSelect: () => addBlock(path, null, 0, kind, template),
      })),
      {
        label: 'Rename model',
        onSelect: () => renameBlock(path, model.nameSpan, model.name),
      },
      {
        label: 'Delete file',
        danger: true,
        onSelect: () => deleteFile(path),
      },
    ];
    return (
      <div key={key}>
        <div
          className="tree-row tree-file"
          style={{ paddingLeft: 22 }}
          onClick={() => toggle(key)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(event.clientX, event.clientY, actions);
          }}
        >
          <span className="outline-kind">model</span>
          <span className="outline-name">{model.name}</span>
        </div>
        {open && renderMembers(model.members, path, 1)}
      </div>
    );
  };

  const renderModelFile = (entry: Extract<PanelFile, { type: 'model' }>): ReactNode => {
    const key = entry.path;
    const open = !isCollapsed(key);
    const actions: ContextAction[] = [
      ...MODEL_ADD_KINDS.map(({ kind, template }) => ({
        label: `Add ${kind}`,
        onSelect: () => addBlock(entry.path, null, 0, kind, template),
      })),
      {
        label: 'Rename model',
        onSelect: () => renameBlock(entry.path, entry.model.nameSpan, entry.model.name),
      },
      {
        label: 'Delete file',
        danger: true,
        onSelect: () => deleteFile(entry.path),
      },
    ];
    return (
      <div key={entry.path}>
        <div
          className="tree-row tree-folder"
          style={{ paddingLeft: 8 }}
          onClick={() => toggle(key)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(event.clientX, event.clientY, actions);
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FileCode2 size={12} />
          <span className="tree-label">{entry.path}</span>
        </div>
        {open && renderModelNode(entry.path, entry.source, entry.model)}
      </div>
    );
  };

  const renderPartFile = (entry: Extract<PanelFile, { type: 'part' }>): ReactNode => {
    const key = entry.path;
    const open = !isCollapsed(key);
    const kind = PART_KIND_BY_PATH[entry.path] ?? 'resource';
    const add = MODEL_ADD_KINDS.find((item) => item.kind === kind);
    const actions: ContextAction[] = [];
    if (add) {
      actions.push({
        label: `Add ${kind}`,
        onSelect: () => addBlock(entry.path, null, 0, kind, add.template),
      });
    }
    actions.push({
      label: 'Delete file',
      danger: true,
      onSelect: () => deleteFile(entry.path),
    });
    return (
      <div key={entry.path}>
        <div
          className="tree-row tree-folder"
          style={{ paddingLeft: 8 }}
          onClick={() => toggle(key)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(event.clientX, event.clientY, actions);
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FileCode2 size={12} />
          <span className="tree-label">{entry.path}</span>
        </div>
        {open && renderMembers(entry.members, entry.path, 1)}
      </div>
    );
  };

  const renderFileRow = (entry: Extract<PanelFile, { type: 'orphan' | 'other' }>): ReactNode => {
    const Icon = entry.type === 'orphan' ? FileX2 : FileJson2;
    return (
      <div
        key={entry.path}
        className={`tree-row tree-file${entry.type === 'other' ? ' tree-muted' : ''}`}
        style={{ paddingLeft: 8 }}
        title={entry.type === 'orphan' ? entry.error : entry.path}
        onContextMenu={(event) => {
          event.preventDefault();
          showMenu(event.clientX, event.clientY, [
            { label: 'Delete file', danger: true, onSelect: () => deleteFile(entry.path) },
          ]);
        }}
      >
        <span className="tree-glyph">
          <Icon size={12} />
        </span>
        <span className="tree-label">{entry.path}</span>
        {entry.type === 'orphan' && <span className="tree-muted">(invalid)</span>}
      </div>
    );
  };

  if (!bundle) {
    return (
      <div className="side-panel-body">
        <div className="side-kv">
          <span className="k">model</span>
          <span className="v">{document.name}</span>
        </div>
        <div className="side-hint">
          创建或打开工程后，这里显示 DSL 代码结构（File &gt; New Project...）
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel-body">
      <div className="tree-row tree-root">
        <span className="tree-glyph">
          <FolderOpen size={13} />
        </span>
        <span className="tree-label">{bundle.manifest.name}</span>
      </div>
      {entries.map((entry) => {
        if (entry.type === 'model') return renderModelFile(entry);
        if (entry.type === 'part') return renderPartFile(entry);
        return renderFileRow(entry);
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={menu.actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// Find the children of the block whose closing brace is at `bodyClose`.
function findChildren(source: string, bodyClose: number): ProjectMember[] {
  const parsed = parseProjectMembers(source);
  if (!parsed.ok || !parsed.members) {
    return [];
  }
  const search = (members: ProjectMember[]): ProjectMember[] => {
    for (const member of members) {
      if (member.bodyClose === bodyClose) {
        return member.children;
      }
      const nested = search(member.children);
      if (nested.length > 0) {
        return nested;
      }
    }
    return [];
  };
  return search(parsed.members);
}
