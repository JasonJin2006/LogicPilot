// Side panel (Project view): the project's CODE structure parsed from the
// DSL files in the bundle. Each model file renders as a collapsible tree of
// blocks; right-click adds/renames/deletes elements, rewriting the DSL text
// in place (projectTree.ts) and marking the project dirty. Files that do not
// parse as a model are shown as orphan rows. Without a project bundle the
// panel shows a hint instead.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FileJson2, FileX2, FolderOpen } from 'lucide-react';
import { parseDsl } from '@logicpilot/editor';
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
  parseProjectSource,
  replaceSpan,
} from '../project/projectTree';
import type { ProjectMember, ProjectModel } from '../project/projectTree';

type PanelEntry =
  | { type: 'model'; path: string; source: string; model: ProjectModel }
  | { type: 'orphan'; path: string; error: string }
  | { type: 'other'; path: string };

interface MenuState {
  x: number;
  y: number;
  actions: ContextAction[];
}

function nextName(source: string, bodyClose: number, kind: string): string {
  const parsed = parseProjectSource(source);
  if (!parsed.ok || !parsed.model) {
    return `${kind}1`;
  }
  const find = (members: ProjectMember[]): ProjectMember[] => {
    for (const member of members) {
      if (member.bodyClose === bodyClose) {
        return member.children;
      }
      const nested = find(member.children);
      if (nested.length > 0) {
        return nested;
      }
    }
    return [];
  };
  const siblings =
    parsed.model.bodyClose === bodyClose ? parsed.model.members : find(parsed.model.members);
  const count = siblings.filter((member) => member.kind === kind).length;
  return `${kind}${count + 1}`;
}

export function ModelInfoPanel() {
  const bundle = useProjectStore((state) => state.bundle);
  const updateFiles = useProjectStore((state) => state.updateFiles);
  const openPrompt = useUiStore((state) => state.openPrompt);
  const document = useModelStore((state) => state.document);
  const loadDocument = useModelStore((state) => state.loadDocument);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const entries = useMemo<PanelEntry[]>(() => {
    if (!bundle) {
      return [];
    }
    return Object.keys(bundle.files)
      .sort()
      .map((path): PanelEntry => {
        const source = bundle.files[path]!;
        if (!path.endsWith('.lp')) {
          return { type: 'other', path };
        }
        const parsed = parseProjectSource(source);
        if (!parsed.ok) {
          return { type: 'orphan', path, error: parsed.error ?? 'invalid DSL' };
        }
        return { type: 'model', path, source, model: parsed.model! };
      });
  }, [bundle]);

  const toggle = (key: string) =>
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  const isCollapsed = (key: string) => collapsed[key] === true;
  const showMenu = (x: number, y: number, actions: ContextAction[]) =>
    setMenu({ x, y, actions });

  const commitEdit = (path: string, apply: (source: string) => string) => {
    const current = useProjectStore.getState().bundle;
    if (!current) {
      return;
    }
    const source = current.files[path] ?? '';
    const next = apply(source);
    updateFiles((files) => ({ ...files, [path]: next }));
    // Best-effort canvas sync for the process subset the canvas can render.
    const canvas = parseDsl(next);
    if (canvas.ok) {
      loadDocument(canvas.document);
    }
  };

  const deleteFile = (path: string) => {
    updateFiles((files) => {
      const next = { ...files };
      delete next[path];
      return next;
    });
  };

  const addBlock = (
    path: string,
    source: string,
    container: { bodyClose: number },
    depth: number,
    kind: string,
    template: (name: string) => string,
  ) => {
    const name = nextName(source, container.bodyClose, kind);
    commitEdit(path, (src) =>
      insertMember(src, container.bodyClose, '  '.repeat(depth + 1), template(name)),
    );
  };

  const renameBlock = (
    path: string,
    source: string,
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
    source: string,
    depth: number,
  ): ReactNode =>
    members
      .filter((member) => !member.isLeaf)
      .map((member) => renderMember(member, path, source, depth));

  const renderMember = (
    member: ProjectMember,
    path: string,
    source: string,
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
          onSelect: () =>
            addBlock(path, source, member, depth, stage.kind, stage.template),
        });
      }
    } else if (member.kind === 'agent') {
      const agent = MODEL_ADD_KINDS.find((entry) => entry.kind === 'agent')!;
      actions.push({
        label: 'Add agent',
        onSelect: () => addBlock(path, source, member, depth, 'agent', agent.template),
      });
    }
    actions.push({
      label: 'Rename',
      onSelect: () => renameBlock(path, source, member.nameSpan!, member.name),
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
        {open && hasChildren && renderMembers(member.children, path, source, depth + 1)}
      </div>
    );
  };

  const renderModel = (entry: Extract<PanelEntry, { type: 'model' }>): ReactNode => {
    const key = entry.path;
    const open = !isCollapsed(key);
    const model = entry.model;
    const actions: ContextAction[] = [
      ...MODEL_ADD_KINDS.map(({ kind, template }) => ({
        label: `Add ${kind}`,
        onSelect: () =>
          addBlock(entry.path, entry.source, model, 0, kind, template),
      })),
      {
        label: 'Rename model',
        onSelect: () =>
          renameBlock(entry.path, entry.source, model.nameSpan, model.name),
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
        {open && (
          <>
            <div
              className="tree-row tree-file"
              style={{ paddingLeft: 22 }}
              onClick={() => toggle(`${key}#model`)}
              onContextMenu={(event) => {
                event.preventDefault();
                showMenu(event.clientX, event.clientY, actions);
              }}
            >
              <span className="outline-kind">model</span>
              <span className="outline-name">{model.name}</span>
            </div>
            {renderMembers(model.members, entry.path, entry.source, 1)}
          </>
        )}
      </div>
    );
  };

  const renderFileRow = (entry: Extract<PanelEntry, { type: 'orphan' | 'other' }>): ReactNode => {
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
        {entry.type === 'orphan' && (
          <span className="tree-muted">(invalid)</span>
        )}
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
      {entries.map((entry) =>
        entry.type === 'model'
          ? renderModel(entry)
          : renderFileRow(entry),
      )}
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
