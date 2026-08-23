import { useMemo } from 'react';
import { useSysMLStore } from '../state/sysmlStore';

export function SysMLPropertiesPanel() {
  const projection = useSysMLStore((state) => state.projection);
  const layout = useSysMLStore((state) => state.layout);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const checkpoint = useSysMLStore((state) => state.checkpoint);
  const move = useSysMLStore((state) => state.move);
  const selected = projection?.elements.find((element) => element.id === selectedId) ?? null;
  const owner = selected?.ownerId
    ? projection?.elements.find((element) => element.id === selected.ownerId)
    : undefined;
  const relations = useMemo(
    () =>
      projection?.relations.filter((relation) => relation.from === selectedId || relation.to === selectedId) ?? [],
    [projection, selectedId],
  );

  if (!projection || !layout || !selected) {
    return <div className="sysml-properties-empty">Select a SysML element to inspect it.</div>;
  }
  const position = layout.positions[selected.id] ?? { x: 80, y: 80 };
  const setPosition = (axis: 'x' | 'y', value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    checkpoint();
    move(selected.id, { ...position, [axis]: Math.max(0, number) });
  };

  return (
    <div className="sysml-properties">
      <div className="sysml-properties-kind">{selected.kind} · {selected.declaration}</div>
      <h3>{selected.name}</h3>
      <div className="sysml-property-row"><span>Qualified name</span><code>{selected.qualifiedName}</code></div>
      <div className="sysml-property-row"><span>Source line</span><strong>{selected.span.line}</strong></div>
      {owner && <div className="sysml-property-row"><span>Owner</span><strong>{owner.qualifiedName}</strong></div>}
      <div className="sysml-property-section-title">Layout</div>
      <label className="sysml-coordinate"><span>X</span><input type="number" value={Math.round(position.x)} onChange={(event) => setPosition('x', event.target.value)} /></label>
      <label className="sysml-coordinate"><span>Y</span><input type="number" value={Math.round(position.y)} onChange={(event) => setPosition('y', event.target.value)} /></label>
      <div className="sysml-property-section-title">Relations</div>
      {relations.length === 0 ? (
        <div className="sysml-properties-muted">No extracted relations.</div>
      ) : (
        <ul className="sysml-relation-list">
          {relations.map((relation) => {
            const otherId = relation.from === selected.id ? relation.to : relation.from;
            const other = projection.elements.find((element) => element.id === otherId);
            return <li key={relation.id}><span>{relation.label}</span><strong>{other?.qualifiedName ?? otherId}</strong></li>;
          })}
        </ul>
      )}
    </div>
  );
}

