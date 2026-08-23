// SysML outline contribution (workbench-architecture-plan.md §5/§9.2): the
// projection's element tree, contributed through the workbench outline seam
// so the Project panel hosts it without importing SysML specifics.

import type { ReactNode } from 'react';
import { Boxes } from 'lucide-react';
import { useSysMLStore } from '../state/sysmlStore';
import { OUTLINE_CONTRIBUTIONS } from '../workbench/outline';
import type { SysMLElement, SysMLProjection } from './sysmlProjection';

function SysMLOutline({ projection, selectedId }: { projection: SysMLProjection; selectedId: string | null }) {
  const select = useSysMLStore((state) => state.select);
  const children = new Map<string | undefined, SysMLElement[]>();
  for (const element of projection.elements) {
    const list = children.get(element.ownerId) ?? [];
    list.push(element);
    children.set(element.ownerId, list);
  }
  const render = (ownerId: string | undefined, depth: number): ReactNode =>
    (children.get(ownerId) ?? []).map((element) => (
      <div key={element.id}>
        <div
          className={`tree-row tree-file${element.id === selectedId ? ' tree-selected' : ''}`}
          style={{ paddingLeft: (depth + 1) * 14 + 8 }}
          title={`${element.kind} ${element.qualifiedName}`}
          onClick={() => select(element.id)}
        >
          <span className="tree-glyph tree-glyph-muted">·</span>
          <span className="tree-glyph"><Boxes size={12} /></span>
          <span className="outline-name">{element.name}</span>
          <span className="sysml-outline-kind">{element.kind}</span>
        </div>
        {render(element.id, depth + 1)}
      </div>
    ));
  return (
    <div className="side-panel-body model-info-panel sysml-outline-panel">
      <div className="sysml-outline-header">SysML Outline</div>
      {render(undefined, 0)}
      <div className="sysml-outline-summary">
        {projection.elements.length} elements · {projection.relations.length} relations
      </div>
    </div>
  );
}

function SysMLOutlinePanel() {
  const projection = useSysMLStore((state) => state.projection);
  const selectedId = useSysMLStore((state) => state.selectedId);
  if (!projection) {
    return (
      <div className="side-panel-body model-info-panel sysml-outline-panel">
        <div className="sysml-outline-header">SysML Outline</div>
        <div className="sysml-outline-summary">No projection loaded.</div>
      </div>
    );
  }
  return <SysMLOutline projection={projection} selectedId={selectedId} />;
}

OUTLINE_CONTRIBUTIONS.register({
  id: 'sysml.outline',
  // The SysML outline replaces the generic project tree while a .sysml
  // document is active.
  priority: 10,
  applies: ({ activeDocumentType }) => activeDocumentType === 'sysml',
  component: SysMLOutlinePanel,
});
