// Presentation Inspector (Figma-style properties panel): position / size /
// rotation, fill / stroke / opacity and inline text options for the
// selected presentation object. Pure: every edit calls back with a fresh
// PresentationObject; the modelStore action commits it (undoable).

import type { PresentationObject } from '@logicpilot/editor';

interface InspectorProps {
  object: PresentationObject;
  onChange: (next: PresentationObject) => void;
}

function numField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step = 1,
  min?: number,
) {
  return (
    <label className="props-field">
      <span className="props-field-name">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

export function PresentationInspector({ object, onChange }: InspectorProps) {
  const t = object.transform;
  const s = object.style;
  const patchTransform = (patch: Partial<PresentationObject['transform']>) =>
    onChange({ ...object, transform: { ...t, ...patch } });
  const patchStyle = (patch: Partial<PresentationObject['style']>) =>
    onChange({ ...object, style: { ...s, ...patch } });
  const ts = object.textStyle;

  return (
    <div className="side-panel-body properties">
      <div className="props-kind">{object.type}</div>
      {numField('X', t.x, (x) => patchTransform({ x }))}
      {numField('Y', t.y, (y) => patchTransform({ y }))}
      {numField('W', t.width, (width) => patchTransform({ width: Math.max(1, width) }), 1, 1)}
      {numField('H', t.height, (height) => patchTransform({ height: Math.max(1, height) }), 1, 1)}
      {numField('Rotation °', t.rotation, (rotation) => patchTransform({ rotation }), 1)}
      <label className="props-field">
        <span className="props-field-name">Fill</span>
        <input
          type="color"
          value={s.fill}
          onChange={(event) => patchStyle({ fill: event.target.value })}
        />
      </label>
      <label className="props-field">
        <span className="props-field-name">Stroke</span>
        <input
          type="color"
          value={s.stroke}
          onChange={(event) => patchStyle({ stroke: event.target.value })}
        />
      </label>
      {numField(
        'Stroke width',
        s.strokeWidth,
        (strokeWidth) => patchStyle({ strokeWidth }),
        0.5,
        0,
      )}
      {numField(
        'Opacity',
        s.opacity,
        (opacity) => patchStyle({ opacity: Math.min(1, Math.max(0, opacity)) }),
        0.05,
        0,
      )}
      {object.type === 'text' && (
        <>
          <label className="props-field">
            <span className="props-field-name">Text</span>
            <textarea
              rows={2}
              value={object.text ?? ''}
              onChange={(event) => onChange({ ...object, text: event.target.value })}
            />
          </label>
          {numField('Font size', ts?.fontSize ?? 16, (fontSize) =>
            onChange({ ...object, textStyle: { ...ts!, fontSize } }),
          )}
          <label className="props-field">
            <span className="props-field-name">Bold</span>
            <input
              type="checkbox"
              checked={(ts?.fontWeight ?? 400) >= 700}
              onChange={(event) =>
                onChange({
                  ...object,
                  textStyle: { ...ts!, fontWeight: event.target.checked ? 700 : 400 },
                })
              }
            />
          </label>
          <label className="props-field">
            <span className="props-field-name">Align</span>
            <select
              value={ts?.align ?? 'center'}
              onChange={(event) =>
                onChange({
                  ...object,
                  textStyle: { ...ts!, align: event.target.value as 'left' | 'center' | 'right' },
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}
