// Right-side Properties panel (P1-7): edits the selected block's name and
// its full AnyLogic-derived property list (libraries/pml-catalog.json).
// Properties are grouped by section (basic / advanced / actions), respect
// their conditional visibility (visibleWhen), and carry a "not executed
// yet" marker for fields without runtime semantics (expressions, actions).

import { useModelStore } from '../state/modelStore';
import { BLOCK_DEFAULTS, blockProperties, type BlockPropertyDef } from './blockDefs';
import { PresentationInspector } from '../presentation/Inspector';
import { useShapeSelection } from '../presentation/selectionStore';

function parseFieldValue(field: BlockPropertyDef, raw: string): string | number | boolean {
  if (field.type === 'int' || field.type === 'float') {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

/** Evaluate a catalog visibleWhen condition against the node's params. */
export function visibleWhenHolds(
  condition: string | null,
  params: Record<string, string | number | boolean>,
): boolean {
  if (!condition) {
    return true;
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(.+)$/.exec(condition.trim());
  if (!match) {
    return true; // unrecognized condition: keep the field visible
  }
  const actual = params[match[1]!];
  const expected = match[2]!.trim();
  if (expected === 'true') {
    return actual === true;
  }
  if (expected === 'false') {
    return actual === false;
  }
  return String(actual) === expected.replace(/^"|"$/g, '');
}

const SECTION_LABELS: Record<string, string> = {
  basic: 'Basic',
  advanced: 'Advanced',
  actions: 'Actions',
};

const NO_RUNTIME_TYPES: ReadonlySet<string> = new Set(['expression']);

export function PropertiesPanel() {
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const renameBlock = useModelStore((state) => state.renameBlock);
  const setBlockParam = useModelStore((state) => state.setBlockParam);
  const setPresentation = useModelStore((state) => state.setPresentation);
  const alignIds = useShapeSelection((state) => state.ids);
  const removeBlock = useModelStore((state) => state.removeBlock);

  const node = (document?.nodes ?? []).find((entry) => entry.id === selectedId);
  if (!node) {
    return (
      <div className="side-panel-body">
        <p className="side-hint">Select a block to edit its name and parameters.</p>
      </div>
    );
  }

  if (node.presentation) {
    return (
      <PresentationInspector
        object={node.presentation}
        onChange={(object) => setPresentation(node.id, object)}
        onUngroup={() => useModelStore.getState().ungroupShape(node.id)}
        alignIds={alignIds}
        onAlign={(axis) =>
          useModelStore.getState().alignShapes([...new Set([...alignIds, node.id])], axis)
        }
        onDistribute={(axis) =>
          useModelStore.getState().distributeShapes([...new Set([...alignIds, node.id])], axis)
        }
        onBringToFront={() => useModelStore.getState().bringToFront(node.id)}
        onSendToBack={() => useModelStore.getState().sendToBack(node.id)}
      />
    );
  }

  const properties = blockProperties(node.kind);
  const valueFor = (field: BlockPropertyDef) =>
    node.params[field.name] ?? BLOCK_DEFAULTS[node.kind]?.[field.name] ?? '';
  const sections = ['basic', 'advanced', 'actions'];
  const visibleBySection = new Map<string, BlockPropertyDef[]>();
  for (const section of sections) {
    visibleBySection.set(
      section,
      properties.filter(
        (field) => field.section === section && visibleWhenHolds(field.visibleWhen, node.params),
      ),
    );
  }

  const renderField = (field: BlockPropertyDef) => {
    const value = valueFor(field);
    const noRuntime = NO_RUNTIME_TYPES.has(field.type) || field.section === 'actions';
    return (
      <label className="props-field" key={field.name}>
        <span className="props-field-name">
          {field.displayName || field.name}
          {noRuntime && (
            <em
              className="props-no-runtime"
              title="Declared for compatibility; the kernel does not execute this yet"
            >
              not executed
            </em>
          )}
        </span>
        {field.type === 'bool' ? (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => setBlockParam(node.id, field.name, event.target.checked)}
          />
        ) : field.type === 'enum' && field.validValues && field.validValues.length > 0 ? (
          <select
            value={String(value)}
            onChange={(event) => setBlockParam(node.id, field.name, event.target.value)}
          >
            {!field.validValues.includes(String(value)) && (
              <option value={String(value)}>{String(value)}</option>
            )}
            {field.validValues.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.type === 'expression' ? (
          <textarea
            rows={2}
            value={String(value)}
            onChange={(event) => setBlockParam(node.id, field.name, event.target.value)}
          />
        ) : (
          <input
            type={field.type === 'int' || field.type === 'float' ? 'number' : 'text'}
            value={String(value)}
            onChange={(event) =>
              setBlockParam(node.id, field.name, parseFieldValue(field, event.target.value))
            }
          />
        )}
      </label>
    );
  };

  return (
    <div className="side-panel-body properties">
      <div className="props-kind">{node.kind}</div>
      <label className="props-field">
        <span className="props-field-name">Name</span>
        <input value={node.name} onChange={(event) => renameBlock(node.id, event.target.value)} />
      </label>
      {sections.map(
        (section) =>
          (visibleBySection.get(section)?.length ?? 0) > 0 && (
            <div className="props-section" key={section}>
              <div className="props-section-title">{SECTION_LABELS[section] ?? section}</div>
              {visibleBySection.get(section)!.map(renderField)}
            </div>
          ),
      )}
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
