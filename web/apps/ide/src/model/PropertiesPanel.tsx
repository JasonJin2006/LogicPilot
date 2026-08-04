// Right-side Properties panel (P1-7): edits the selected block's name and
// library fields (shapes mirrored from libraries/process.lplib). The right
// area tab switching on selection lives in Workspace (avoids a module cycle
// through the layout registry).

import { useModelStore } from '../state/modelStore';
import { BLOCK_DEFAULTS, BLOCK_FIELDS, type BlockField } from './blockDefs';

function parseFieldValue(field: BlockField, raw: string): string | number | boolean {
  if (field.type === 'int' || field.type === 'float') {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

export function PropertiesPanel() {
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const renameBlock = useModelStore((state) => state.renameBlock);
  const setBlockParam = useModelStore((state) => state.setBlockParam);
  const removeBlock = useModelStore((state) => state.removeBlock);

  const node = document.nodes.find((entry) => entry.id === selectedId);
  if (!node) {
    return (
      <div className="side-panel-body">
        <p className="side-hint">Select a block to edit its name and parameters.</p>
      </div>
    );
  }

  const fields = BLOCK_FIELDS[node.kind];
  const valueFor = (field: BlockField) =>
    node.params[field.key] ?? BLOCK_DEFAULTS[node.kind][field.key] ?? '';

  return (
    <div className="side-panel-body properties">
      <div className="props-kind">{node.kind}</div>
      <label className="props-field">
        <span>Name</span>
        <input value={node.name} onChange={(event) => renameBlock(node.id, event.target.value)} />
      </label>
      {fields.map((field) => (
        <label className="props-field" key={field.key}>
          <span>{field.key}</span>
          <input
            type={field.type === 'int' || field.type === 'float' ? 'number' : 'text'}
            value={String(valueFor(field))}
            onChange={(event) =>
              setBlockParam(node.id, field.key, parseFieldValue(field, event.target.value))
            }
          />
        </label>
      ))}
      <div className="props-meta">
        <span>x: {Math.round(node.x * 100) / 100}</span>
        <span>y: {Math.round(node.y * 100) / 100}</span>
      </div>
      <button className="props-delete" onClick={() => removeBlock(node.id)}>
        Delete block
      </button>
    </div>
  );
}
