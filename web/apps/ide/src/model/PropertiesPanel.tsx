// Right-side Properties panel (P1-7): edits the selected block's name and
// its full AnyLogic-derived property list (libraries/pml-catalog.json).
// Properties are grouped by section (basic / advanced / actions), respect
// their conditional visibility (visibleWhen), and carry a "not executed
// yet" marker for fields without runtime semantics (expressions, actions).

import { useModelStore } from '../state/modelStore';
import { BLOCK_DEFAULTS, blockProperties, type BlockPropertyDef } from './blockDefs';
import { PresentationInspector } from '../presentation/Inspector';
import { useShapeSelection } from '../presentation/selectionStore';
import { useState } from 'react';

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

/** Expression fields the kernel evaluates at runtime (ADR-0009 scripting
 *  Phase 1): routing/blocking conditions and comparison expressions. These
 *  must not carry the "not executed" marker; everything else stays honest
 *  until the engine implements it. Keyed by `${blockKind}.${fieldName}`. */
const EXECUTED_EXPRESSIONS: ReadonlySet<string> = new Set([
  'selectOutput.condition',
  'selectOutput5.condition1',
  'selectOutput5.condition2',
  'selectOutput5.condition3',
  'selectOutput5.condition4',
  'selectOutput5.exitNumber',
  'selectOutputIn.choice',
  'hold.blockingCondition',
  'match.matchCondition',
  'queue.agent1IsPreferredToAgent2',
  'transition.condition',
]);

export type PropertyExecutionStatus = 'executed' | 'partial' | 'not-executed';

/**
 * Runtime contract for the DES MVP blocks. The imported catalog deliberately
 * retains the full AnyLogic property surface as reference metadata, but these
 * sets prevent the editor from presenting a parsed/documented field as if the
 * LogicPilot runtime already honored it.
 */
const DES_MVP_EXECUTED_PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  resource: new Set(['capacity', 'failure_rate', 'repair_rate']),
  source: new Set([
    'arrival',
    'interarrivalTime',
    'firstArrivalMode',
    'firstArrivalTime',
    'multipleEntitiesPerArrival',
    'agentsPerArrival',
    'limitArrivals',
    'maxArrivals',
  ]),
  queue: new Set([
    'capacity',
    'maximumCapacity',
    'queuing',
    'agentPriority',
    'agent1IsPreferredToAgent2',
    'enableTimeout',
    'timeout',
    'enablePreemption',
  ]),
  service: new Set([
    'resource',
    'numberOfUnits',
    'queueCapacity',
    'maximumCapacity',
    'time',
    'taskPriority',
    'taskMayPreempt',
    'enableTimeout',
    'timeout',
    'enablePreemption',
  ]),
  sink: new Set(),
};

const DES_MVP_PARTIAL_PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  // Rate, interarrival time and manual mode are recognized. Schedule/database
  // modes fail explicitly and manual injection has no public command yet.
  source: new Set(['arrivalType']),
  // Only the single-pool mode and terminate-style task preemption execute.
  service: new Set(['seizeFromOnePool', 'taskPreemptionPolicy']),
};

export function propertyExecutionStatus(
  blockKind: string,
  field: Pick<BlockPropertyDef, 'name' | 'type' | 'section'>,
): PropertyExecutionStatus {
  const executed = DES_MVP_EXECUTED_PROPERTIES[blockKind];
  if (executed) {
    if (executed.has(field.name)) return 'executed';
    if (DES_MVP_PARTIAL_PROPERTIES[blockKind]?.has(field.name)) return 'partial';
    return 'not-executed';
  }
  if (field.section === 'actions') return 'not-executed';
  if (NO_RUNTIME_TYPES.has(field.type) && !EXECUTED_EXPRESSIONS.has(`${blockKind}.${field.name}`)) {
    return 'not-executed';
  }
  return 'executed';
}

/** Modern toggle switch (replaces the native checkbox in the properties
 *  panel): hidden input drives the styled track/thumb. */
function Toggle({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <span className="props-toggle" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="props-toggle-track" aria-hidden="true" />
    </span>
  );
}

/** Entity attributes are stored as `state <name>: <type>` params on the
 *  source block (the DSL form generated/parsed by the editor round-trip). */
const ATTRIBUTE_PREFIX = 'state ';

function attributeKey(name: string, type: string): string {
  return type ? `${ATTRIBUTE_PREFIX}${name}: ${type}` : `${ATTRIBUTE_PREFIX}${name}`;
}

function inferAttributeType(value: string | number | boolean): string {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  return 'int';
}

export function PropertiesPanel() {
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const renameBlock = useModelStore((state) => state.renameBlock);
  const setBlockParam = useModelStore((state) => state.setBlockParam);
  const removeBlockParam = useModelStore((state) => state.removeBlockParam);
  const renameBlockParam = useModelStore((state) => state.renameBlockParam);
  const setPresentation = useModelStore((state) => state.setPresentation);
  const alignIds = useShapeSelection((state) => state.ids);
  const removeBlock = useModelStore((state) => state.removeBlock);
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState('int');

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
        onBoolean={(op) =>
          useModelStore.getState().applyBooleanShapes([...new Set([...alignIds, node.id])], op)
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
  const isSource = node.kind === 'source';
  const attributeEntries = isSource
    ? Object.entries(node.params)
        .filter(([key]) => key.startsWith(ATTRIBUTE_PREFIX))
        .map(([key, value]) => {
          const rest = key.slice(ATTRIBUTE_PREFIX.length);
          const colon = rest.indexOf(':');
          const name = colon >= 0 ? rest.slice(0, colon).trim() : rest.trim();
          const type = colon >= 0 ? rest.slice(colon + 1).trim() : inferAttributeType(value);
          return { key, name, type, value };
        })
    : [];

  const setAttributeValue = (key: string, type: string, raw: string) => {
    if (type === 'bool') {
      setBlockParam(node.id, key, raw === 'true');
      return;
    }
    const parsed = Number(raw);
    setBlockParam(node.id, key, raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw);
  };

  const renameAttribute = (oldKey: string, name: string, type: string) => {
    const clean = name.trim();
    if (!clean) return;
    renameBlockParam(node.id, oldKey, attributeKey(clean, type));
  };

  const changeAttributeType = (
    oldKey: string,
    name: string,
    newType: string,
    value: string | number | boolean,
  ) => {
    const key = attributeKey(name, newType);
    renameBlockParam(node.id, oldKey, key);
    if (newType === 'bool' && typeof value !== 'boolean') {
      setBlockParam(node.id, key, true);
    } else if (newType !== 'bool' && typeof value === 'boolean') {
      setBlockParam(node.id, key, value ? 1 : 0);
    }
  };
  const visibleBySection = new Map<string, BlockPropertyDef[]>();
  // Newly dropped blocks store only user overrides. Conditional visibility
  // must still evaluate against catalog defaults (for example a Source's
  // default arrivalType is "rate"), otherwise its primary fields disappear
  // until an unrelated property is edited.
  const effectiveParams = {
    ...(BLOCK_DEFAULTS[node.kind] ?? {}),
    ...node.params,
  };
  for (const section of sections) {
    visibleBySection.set(
      section,
      properties.filter(
        (field) =>
          field.section === section && visibleWhenHolds(field.visibleWhen, effectiveParams),
      ),
    );
  }

  const renderField = (field: BlockPropertyDef) => {
    const value = valueFor(field);
    const execution = propertyExecutionStatus(node.kind, field);
    return (
      <label className="props-field" key={field.name}>
        <span className="props-field-name">
          {field.displayName || field.name}
          {execution !== 'executed' && (
            <em
              className="props-no-runtime"
              title={
                execution === 'partial'
                  ? 'Only a documented subset is executed by the current runtime'
                  : 'Declared for compatibility; the kernel does not execute this yet'
              }
            >
              {execution === 'partial' ? 'partial' : 'not executed'}
            </em>
          )}
        </span>
        {field.type === 'bool' ? (
          <Toggle
            checked={value === true}
            onChange={(checked) => setBlockParam(node.id, field.name, checked)}
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
      {isSource && (
        <div className="props-section">
          <div className="props-section-title">Entity attributes</div>
          {attributeEntries.map((attribute) => (
            <div className="props-attribute" key={attribute.key}>
              <input
                className="props-attr-name"
                value={attribute.name}
                onChange={(event) =>
                  renameAttribute(attribute.key, event.target.value, attribute.type)
                }
              />
              <select
                value={attribute.type}
                onChange={(event) =>
                  changeAttributeType(
                    attribute.key,
                    attribute.name,
                    event.target.value,
                    attribute.value,
                  )
                }
              >
                <option value="int">int</option>
                <option value="float">float</option>
                <option value="bool">bool</option>
              </select>
              {attribute.type === 'bool' ? (
                <Toggle
                  checked={attribute.value === true}
                  onChange={(checked) => setBlockParam(node.id, attribute.key, checked)}
                />
              ) : (
                <input
                  type={attribute.type === 'int' || attribute.type === 'float' ? 'number' : 'text'}
                  value={String(attribute.value)}
                  onChange={(event) =>
                    setAttributeValue(attribute.key, attribute.type, event.target.value)
                  }
                />
              )}
              <button
                type="button"
                className="props-attr-remove"
                title="Remove attribute"
                onClick={() => removeBlockParam(node.id, attribute.key)}
              >
                ×
              </button>
            </div>
          ))}
          <div className="props-attribute">
            <input
              className="props-attr-name"
              placeholder="new attribute"
              value={newAttrName}
              onChange={(event) => setNewAttrName(event.target.value)}
            />
            <select value={newAttrType} onChange={(event) => setNewAttrType(event.target.value)}>
              <option value="int">int</option>
              <option value="float">float</option>
              <option value="bool">bool</option>
            </select>
            <button
              type="button"
              className="props-attr-add"
              title="Add attribute"
              onClick={() => {
                const name = newAttrName.trim();
                if (!name) return;
                setBlockParam(
                  node.id,
                  attributeKey(name, newAttrType),
                  newAttrType === 'bool' ? true : 0,
                );
                setNewAttrName('');
              }}
            >
              +
            </button>
          </div>
        </div>
      )}
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
