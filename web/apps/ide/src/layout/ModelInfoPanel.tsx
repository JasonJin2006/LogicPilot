// Side panel (Project view): the project's ELEMENT hierarchy, mirroring how
// AnyLogic's Projects view organises a model - the model at the top level,
// its elements (resources / processes / agents / experiments...) one level
// down, and nested elements in branches below. The per-concern part files
// are merged into the model tree; file names belong to the Explorer, not
// here. Right-click adds/renames/deletes elements in their owning file;
// files that do not parse as a model are listed as orphan rows at the end.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  FileX2,
  FolderOpen,
} from 'lucide-react';
import { parseDsl } from '@logicpilot/editor';
import { DEFAULT_MODEL_PATH, mergeModelSource } from '../project/project';
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

interface MergedMember {
  file: string;
  member: ProjectMember;
}

type PanelEntry =
  | { type: 'model'; path: string; source: string; model: ProjectModel; members: MergedMember[] }
  | { type: 'orphan'; path: string; error: string };

interface MenuState {
  x: number;
  y: number;
  actions: ContextAction[];
}

const PART_PATH_BY_KIND: Record<string, string> = {
  resource: 'model/resources.lp',
  process: 'model/process.lp',
  agent: 'model/agents.lp',
  experiment: 'model/experiments.lp',
};

function kindRank(kind: string): number {
  switch (kind) {
    case 'resource':
      return 0;
    case 'process':
      return 1;
    case 'agent':
      return 2;
    case 'experiment':
      return 3;
    case 'atomic':
      return 4;
    case 'continuous':
      return 5;
    default:
      return 6;
  }
}

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

  const partPaths = bundle?.manifest.modelParts ?? [];

  const entries = useMemo<PanelEntry[]>(() => {
    if (!bundle) {
      return [];
    }
    const files = bundle.files;
    const models: PanelEntry[] = [];
    const orphans: PanelEntry[] = [];
    for (const path of Object.keys(files).sort()) {
      const source = files[path]!;
      if (!path.endsWith('.lp')) {
        continue; // data files (canvas layout, assets) belong to the Explorer
      }
      if (partPaths.includes(path)) {
        // Fragments belong to their model; parse them lazily through the main
        // file below. Report a broken fragment only if no model referenced it.
        continue;
      }
      const parsed = parseProjectSource(source);
      if (!parsed.ok) {
        orphans.push({ type: 'orphan', path, error: parsed.error ?? 'invalid DSL' });
        continue;
      }
      const members: MergedMember[] = parsed
        .model!.members.filter((member) => !member.isLeaf)
        .map((member) => ({ file: path, member }));
      for (const part of partPaths) {
        const partSource = files[part];
        if (partSource === undefined) {
          continue;
        }
        const partParsed = parseProjectMembers(partSource);
        if (!partParsed.ok) {
          orphans.push({ type: 'orphan', path: part, error: partParsed.error ?? 'invalid fragment' });
          continue;
        }
        for (const member of partParsed.members ?? []) {
          if (!member.isLeaf) {
            members.push({ file: part, member });
          }
        }
      }
      members.sort(
        (a, b) =>
          kindRank(a.member.kind) - kindRank(b.member.kind) ||
          a.member.name.localeCompare(b.member.name),
      );
      models.push({ type: 'model', path, source, model: parsed.model!, members });
    }
    return [...models, ...orphans];
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

  const renderMembers = (members: MergedMember[], depth: number): ReactNode =>
    members.map((entry) => renderMember(entry, depth));

  const renderMember = (entry: MergedMember, depth: number): ReactNode => {
    const { file, member } = entry;
    const key = `${file}:${member.kind}:${member.name}`;
    const open = !isCollapsed(key);
    const hasChildren = member.children.length > 0;
    const actions: ContextAction[] = [];
    if (member.kind === 'process') {
      for (const stage of STAGE_ADD_KINDS) {
        actions.push({
          label: `Add ${stage.kind}`,
          onSelect: () => addBlock(file, member, depth, stage.kind, stage.template),
        });
      }
    } else if (member.kind === 'agent') {
      const agent = MODEL_ADD_KINDS.find((item) => item.kind === 'agent')!;
      actions.push({
        label: 'Add agent',
        onSelect: () => addBlock(file, member, depth, 'agent', agent.template),
      });
    }
    actions.push({
      label: 'Rename',
      onSelect: () => renameBlock(file, member.nameSpan!, member.name),
    });
    actions.push({
      label: 'Delete',
      danger: true,
      onSelect: () => deleteBlock(file, member.span),
    });
    return (
      <div key={key}>
        <div
          className="tree-row tree-file"
          style={{ paddingLeft: (depth + 1) * 14 + 8 }}
          title={`${member.kind} ${member.name} — ${file}`}
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
        {open && hasChildren && renderMembers(childrenOf(entry), depth + 1)}
      </div>
    );
  };

  const renderModel = (entry: Extract<PanelEntry, { type: 'model' }>): ReactNode => {
    const key = `${entry.path}#model`;
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
    ];
    return (
      <div key={key}>
        <div
          className="tree-row tree-folder"
          style={{ paddingLeft: 8 }}
          title={entry.path}
          onClick={() => toggle(key)}
          onContextMenu={(event) => {
            event.preventDefault();
            showMenu(event.clientX, event.clientY, actions);
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Boxes size={12} />
          <span className="outline-kind">Model</span>
          <span className="outline-name">{entry.model.name}</span>
        </div>
        {open && renderMembers(entry.members, 1)}
      </div>
    );
  };

  const renderFileRow = (entry: Extract<PanelEntry, { type: 'orphan' }>): ReactNode => {
    return (
      <div
        key={entry.path}
        className="tree-row tree-file"
        style={{ paddingLeft: 8 }}
        title={entry.error}
        onContextMenu={(event) => {
          event.preventDefault();
          showMenu(event.clientX, event.clientY, [
            { label: 'Delete file', danger: true, onSelect: () => deleteFile(entry.path) },
          ]);
        }}
      >
        <span className="tree-glyph">
          <FileX2 size={12} />
        </span>
        <span className="tree-label">{entry.path}</span>
        <span className="tree-muted">(invalid)</span>
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
          创建或打开工程后，这里显示模型的元素层级（File &gt; New Project...）
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
        entry.type === 'model' ? renderModel(entry) : renderFileRow(entry),
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

function childrenOf(entry: MergedMember): MergedMember[] {
  return entry.member.children
    .filter((member) => !member.isLeaf)
    .map((member) => ({ file: entry.file, member }));
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
