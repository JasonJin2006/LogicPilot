// SysML v2 table views (plan slice: official Part / Requirement /
// Allocation tables). One tabbed table surface over the projection; a row
// click selects the element so the Properties panel and canvas follow.

import { useState } from 'react';
import { useSysMLStore } from '../state/sysmlStore';
import {
  allocationRows,
  partRows,
  requirementRows,
} from './sysmlTables';
import { ScrollArea } from '../components/ScrollArea';

type TableTab = 'parts' | 'requirements' | 'allocations';

const TABS: ReadonlyArray<{ id: TableTab; label: string }> = [
  { id: 'parts', label: 'Part Table' },
  { id: 'requirements', label: 'Requirement Table' },
  { id: 'allocations', label: 'Allocation Table' },
];

export function SysMLTables() {
  const projection = useSysMLStore((state) => state.projection);
  const selectedId = useSysMLStore((state) => state.selectedId);
  const select = useSysMLStore((state) => state.select);
  const [tab, setTab] = useState<TableTab>('parts');
  if (!projection) {
    return <div className="sysml-empty">Open a .sysml file to inspect its tables.</div>;
  }

  const parts = partRows(projection);
  const requirements = requirementRows(projection);
  const allocations = allocationRows(projection);
  const pick = (id: string) => select(id);

  return (
    <div className="sysml-tables">
      <div className="sysml-tables-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`sysml-tables-tab${tab === entry.id ? ' active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            <span className="sysml-tables-count">
              {entry.id === 'parts'
                ? parts.length
                : entry.id === 'requirements'
                  ? requirements.length
                  : allocations.length}
            </span>
          </button>
        ))}
      </div>
      <ScrollArea className="sysml-tables-scroll">
        {tab === 'parts' && (
          <table className="sysml-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Type</th>
                <th>Owner</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? ' selected' : ''}
                  onClick={() => pick(row.id)}
                >
                  <td>{row.name}</td>
                  <td>{row.declaration}</td>
                  <td>{row.type ?? '—'}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'requirements' && (
          <table className="sysml-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Relations</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? ' selected' : ''}
                  onClick={() => pick(row.id)}
                >
                  <td>{row.name}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.relations}</td>
                  <td>{row.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'allocations' && (
          <table className="sysml-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((row) => (
                <tr key={row.id} onClick={() => pick(row.id)}>
                  <td>{row.from}</td>
                  <td>{row.to}</td>
                  <td>{row.line}</td>
                </tr>
              ))}
              {allocations.length === 0 && (
                <tr>
                  <td colSpan={3} className="sysml-tables-empty">
                    No allocation statements in this model.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}
