// SysML element inspector, hosted inside the shared Properties panel
// (layout/PropertiesHost). Read-only inspection plus typed visual edits:
// rename / delete / relation statements all go through sysmlEditBridge,
// which writes the authoritative .sysml text and lets the normal reparse
// update projection, layout and diagnostics.

import { useEffect, useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useSysMLStore } from '../state/sysmlStore';
import { useUiStore } from '../state/uiStore';
import { useLayoutStore } from '../state/layoutStore';
import { useProjectStore } from '../state/projectStore';
import { addRelation, deleteSelected, renameSelected } from './sysmlEditBridge';
import type { RelationVerb } from './sysmlEdits';

const RELATION_VERBS: ReadonlyArray<{ verb: RelationVerb; label: string }> = [
  { verb: 'satisfy', label: 'satisfies' },
  { verb: 'verify', label: 'verifies' },
  { verb: 'trace', label: 'traces' },
  { verb: 'connect', label: 'connect' },
  { verb: 'allocate', label: 'allocates' },
  { verb: 'bind', label: 'binds' },
];

export function SysMLPropertiesPanel() {
  const projection = useSysMLStore((state) => state.projection);
  const layout = useSysMLStore((state) => state.layout);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const checkpoint = useSysMLStore((state) => state.checkpoint);
  const move = useSysMLStore((state) => state.move);
  const origins = useSysMLStore((state) => state.origins);
  const selected = projection?.elements.find((element) => element.id === selectedId) ?? null;
  const owner = selected?.ownerId
    ? projection?.elements.find((element) => element.id === selected.ownerId)
    : undefined;
  const relations = useMemo(
    () =>
      projection?.relations.filter(
        (relation) => relation.from === selectedId || relation.to === selectedId,
      ) ?? [],
    [projection, selectedId],
  );

  const path = useSysMLStore((state) => state.path);
  const originPath = selected ? origins[selected.id] : undefined;
  const foreign = originPath !== undefined && originPath !== path;

  // Rename draft follows the selection so switching elements resets it.
  const [nameDraft, setNameDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => {
    setNameDraft(selected?.name ?? '');
    setEditError(null);
  }, [selected?.id, selected?.name]);
  const [relationVerb, setRelationVerb] = useState<RelationVerb>('connect');
  const [relationTarget, setRelationTarget] = useState('');

  if (!projection || !layout || !selected) {
    return <div className="sysml-properties-empty">Select a SysML element to inspect it.</div>;
  }
  const openInSource = () => {
    // In a linked workspace the element may live in a sibling file; open
    // whichever document owns it, then reveal the declaration offset.
    const targetPath = originPath ?? path;
    if (targetPath === null) return;
    if (targetPath !== useUiStore.getState().activeFile) {
      const bundled = useProjectStore.getState().bundle?.files[targetPath];
      const ui = useUiStore.getState();
      if (bundled !== undefined) {
        ui.openFile(targetPath);
      } else if (ui.diskFiles[targetPath] !== undefined) {
        ui.openDiskFile(targetPath, ui.diskFiles[targetPath]!);
      } else {
        return;
      }
    }
    useLayoutStore.getState().openPanel('center', 'dsl');
    useUiStore
      .getState()
      .revealInSource(targetPath, selected.nameSpan.start, selected.nameSpan.end);
  };
  const position = layout.positions[selected.id] ?? { x: 80, y: 80 };
  const setPosition = (axis: 'x' | 'y', value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    checkpoint();
    move(selected.id, { ...position, [axis]: Math.max(0, number) });
  };
  const applyRename = () => {
    if (selected === null) return;
    const result = renameSelected(selected.id, nameDraft);
    setEditError(result.ok ? null : result.error);
  };
  const applyDelete = () => {
    if (selected === null) return;
    useUiStore.getState().openConfirm({
      title: 'Delete SysML element',
      body: `Remove ${selected.kind} '${selected.name}' (and anything nested inside it) from the source?`,
      actions: [
        {
          label: 'Delete',
          primary: true,
          onSelect: () => {
            const result = deleteSelected(selected.id);
            setEditError(result.ok ? null : result.error);
          },
        },
        { label: 'Cancel', onSelect: () => undefined },
      ],
    });
  };
  const submitRelation = () => {
    if (selected === null || relationTarget.trim() === '') return;
    const result = addRelation(relationVerb, selected.name, relationTarget.trim());
    setEditError(result.ok ? null : result.error);
    if (result.ok) setRelationTarget('');
  };

  return (
    <div className="side-panel-body properties sysml-properties">
      <div className="props-kind">
        {selected.kind} · {selected.declaration}
      </div>
      <label className="props-field">
        <span className="props-field-name">Name</span>
        <span className="sysml-rename-row">
          <input
            value={nameDraft}
            aria-label="Element name"
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyRename();
            }}
          />
          <button
            type="button"
            title="Rename in source (updates every reference)"
            disabled={nameDraft.trim() === '' || nameDraft === selected.name}
            onClick={applyRename}
          >
            <Check size={13} />
          </button>
        </span>
      </label>
      <div className="sysml-property-row">
        <span>Qualified name</span>
        <code>{selected.qualifiedName}</code>
      </div>
      {selected.doc !== undefined && (
        <p className="sysml-properties-muted sysml-doc-text" title={selected.doc}>
          {selected.doc}
        </p>
      )}
      <div className="sysml-property-row">
        <span>Source line</span>
        <strong>
          {selected.span.line}{' '}
          <button type="button" className="sysml-link" onClick={openInSource}>
            Open in source
          </button>
        </strong>
      </div>
      {foreign && originPath !== undefined && (
        <div className="sysml-property-row">
          <span>Defined in</span>
          <strong title={originPath}>{originPath.split('/').pop()}</strong>
        </div>
      )}
      {owner && (
        <div className="sysml-property-row">
          <span>Owner</span>
          <strong>{owner.qualifiedName}</strong>
        </div>
      )}
      {editError !== null && <p className="sysml-edit-error">{editError}</p>}
      <div className="props-section-title">Layout</div>
      <label className="props-field">
        <span>X</span>
        <input
          type="number"
          value={Math.round(position.x)}
          onChange={(event) => setPosition('x', event.target.value)}
        />
      </label>
      <label className="props-field">
        <span>Y</span>
        <input
          type="number"
          value={Math.round(position.y)}
          onChange={(event) => setPosition('y', event.target.value)}
        />
      </label>
      <div className="props-section-title">Relations</div>
      {relations.length === 0 ? (
        <div className="sysml-properties-muted">No extracted relations.</div>
      ) : (
        <ul className="sysml-relation-list">
          {relations.map((relation) => {
            const otherId = relation.from === selected.id ? relation.to : relation.from;
            const other = projection.elements.find((element) => element.id === otherId);
            return (
              <li key={relation.id}>
                <span>{relation.label}</span>
                <strong>{other?.qualifiedName ?? otherId}</strong>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sysml-relation-add">
        <select
          aria-label="Relation kind"
          value={relationVerb}
          onChange={(event) => setRelationVerb(event.target.value as RelationVerb)}
        >
          {RELATION_VERBS.map(({ verb, label }) => (
            <option key={verb} value={verb}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={relationTarget}
          placeholder="target name"
          aria-label="Relation target"
          onChange={(event) => setRelationTarget(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitRelation();
          }}
        />
        <button
          type="button"
          title="Append the relation statement to the source"
          disabled={relationTarget.trim() === ''}
          onClick={submitRelation}
        >
          Add
        </button>
      </div>
      <button type="button" className="sysml-delete-row" onClick={applyDelete}>
        <Trash2 size={13} /> Delete element
      </button>
    </div>
  );
}
