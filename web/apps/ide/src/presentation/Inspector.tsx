// Vector graphics Inspector (Figma-style property panel): position / size /
// rotation, geometry (corner radius), fill (solid / linear gradient),
// stroke (color / width / dash), opacity, shadow, blur, text options, image
// loading, group ungroup, arrange (z-order) and multi-select align/distribute.
// Pure: every edit calls back with a fresh GraphicNode; the model store
// commits it (undoable).

import { createGraphicNode } from '@logicpilot/editor';
import type { GraphicNode, GraphicStyle } from '@logicpilot/editor';
import type { AlignAxis, DistributeAxis } from '../state/modelStore';

interface InspectorProps {
  object: GraphicNode;
  onChange: (next: GraphicNode) => void;
  /** Expand a selected `group` back into its children. */
  onUngroup?: () => void;
  /** Multi-selected shape ids (for alignment). */
  alignIds?: string[];
  onAlign?: (axis: AlignAxis) => void;
  onDistribute?: (axis: DistributeAxis) => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
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

export function PresentationInspector({
  object,
  onChange,
  onUngroup,
  alignIds,
  onAlign,
  onDistribute,
  onBringToFront,
  onSendToBack,
}: InspectorProps) {
  const t = object.transform;
  const s = object.style;
  const patchTransform = (patch: Partial<GraphicNode['transform']>) =>
    onChange({ ...object, transform: { ...t, ...patch } });
  const patchStyle = (patch: Partial<GraphicStyle>) =>
    onChange({ ...object, style: { ...s, ...patch } });
  const patchGeometry = (patch: Partial<NonNullable<GraphicNode['geometry']>>) =>
    onChange({ ...object, geometry: { ...object.geometry!, ...patch } });
  const ts = object.textStyle;
  const shapeType = object.type === 'shape' ? object.geometry?.shapeType : undefined;
  const shadow = s.shadow;
  const fill = s.fill;
  const binding = object.binding;
  const bindings = binding?.properties ?? {};
  const patchBinding = (properties: Record<string, string>) =>
    onChange({ ...object, binding: { properties } });
  const patchLayout = (patch: Partial<NonNullable<GraphicNode['layout']>>) =>
    onChange({ ...object, layout: { ...object.layout!, ...patch } });
  const addChild = (kind: 'rect' | 'oval' | 'text') =>
    onChange({ ...object, children: [...(object.children ?? []), createGraphicNode(kind, 0, 0)] });

  return (
    <div className="side-panel-body properties">
      <div className="props-kind">
        {object.type === 'shape' ? (shapeType ?? 'shape') : object.type}
      </div>
      {numField('X', t.x, (x) => patchTransform({ x }))}
      {numField('Y', t.y, (y) => patchTransform({ y }))}
      {numField('W', t.width, (width) => patchTransform({ width: Math.max(1, width) }), 1, 1)}
      {numField('H', t.height, (height) => patchTransform({ height: Math.max(1, height) }), 1, 1)}
      {numField('Rotation °', t.rotation, (rotation) => patchTransform({ rotation }), 1)}

      {shapeType === 'rectangle' && (
        <label className="props-field">
          <span className="props-field-name">Corner radius</span>
          <input
            type="number"
            value={object.geometry?.radius ?? 0}
            min={0}
            onChange={(event) =>
              patchGeometry({ radius: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>
      )}

      <label className="props-field">
        <span className="props-field-name">Fill</span>
        <select
          value={fill.kind}
          onChange={(event) =>
            patchStyle({
              fill:
                event.target.value === 'gradient'
                  ? {
                      kind: 'gradient',
                      angle: 0,
                      stops: [
                        { offset: 0, color: fill.kind === 'solid' ? fill.color : '#ffffff' },
                        { offset: 1, color: '#000000' },
                      ],
                    }
                  : { kind: 'solid', color: fill.kind === 'solid' ? fill.color : '#ffffff' },
            })
          }
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
        </select>
      </label>
      {fill.kind === 'solid' ? (
        <label className="props-field">
          <span className="props-field-name">Fill color</span>
          <input
            type="color"
            value={fill.color}
            onChange={(event) => patchStyle({ fill: { kind: 'solid', color: event.target.value } })}
          />
        </label>
      ) : fill.kind === 'gradient' ? (
        <>
          {numField('Angle °', fill.angle, (angle) => patchStyle({ fill: { ...fill, angle } }))}
          {fill.stops.map((stop, index) => (
            <div key={index} className="props-align-row">
              <input
                type="color"
                value={stop.color}
                onChange={(event) =>
                  patchStyle({
                    fill: {
                      ...fill,
                      stops: fill.stops.map((entry, i) =>
                        i === index ? { ...entry, color: event.target.value } : entry,
                      ),
                    },
                  })
                }
              />
              {numField(`Stop ${index + 1}`, stop.offset, (offset) =>
                patchStyle({
                  fill: {
                    ...fill,
                    stops: fill.stops.map((entry, i) =>
                      i === index ? { ...entry, offset: Math.min(1, Math.max(0, offset)) } : entry,
                    ),
                  },
                }),
              )}
            </div>
          ))}
        </>
      ) : null}

      <label className="props-field">
        <span className="props-field-name">Stroke</span>
        <input
          type="color"
          value={s.stroke.color}
          onChange={(event) => patchStyle({ stroke: { ...s.stroke, color: event.target.value } })}
        />
      </label>
      {numField(
        'Stroke width',
        s.stroke.width,
        (width) => patchStyle({ stroke: { ...s.stroke, width } }),
        0.5,
        0,
      )}
      <label className="props-field">
        <span className="props-field-name">Stroke dash</span>
        <input
          type="text"
          value={s.stroke.dash.join(' ')}
          placeholder="e.g. 6 4"
          onChange={(event) =>
            patchStyle({
              stroke: {
                ...s.stroke,
                dash: event.target.value
                  .split(/\s+/)
                  .map(Number)
                  .filter((entry) => Number.isFinite(entry)),
              },
            })
          }
        />
      </label>
      {numField(
        'Opacity',
        s.opacity,
        (opacity) => patchStyle({ opacity: Math.min(1, Math.max(0, opacity)) }),
        0.05,
        0,
      )}

      <label className="props-field">
        <span className="props-field-name">Shadow</span>
        <input
          type="checkbox"
          checked={!!s.shadow}
          onChange={(event) =>
            patchStyle(
              event.target.checked
                ? { shadow: { x: 2, y: 2, blur: 4, spread: 0, color: 'rgba(0,0,0,0.4)' } }
                : { shadow: undefined },
            )
          }
        />
      </label>
      {shadow && (
        <>
          {numField('Shadow X', shadow.x, (x) => patchStyle({ shadow: { ...shadow, x } }))}
          {numField('Shadow Y', shadow.y, (y) => patchStyle({ shadow: { ...shadow, y } }))}
          {numField(
            'Shadow blur',
            shadow.blur,
            (blur) => patchStyle({ shadow: { ...shadow, blur } }),
            0.5,
          )}
          <label className="props-field">
            <span className="props-field-name">Shadow color</span>
            <input
              type="color"
              value={shadow.color.startsWith('#') ? shadow.color : '#000000'}
              onChange={(event) => patchStyle({ shadow: { ...shadow, color: event.target.value } })}
            />
          </label>
        </>
      )}
      {numField(
        'Blur',
        s.blur ?? 0,
        (blur) => patchStyle({ blur: blur > 0 ? blur : undefined }),
        0.5,
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
      {object.type === 'image' && (
        <label className="props-field">
          <span className="props-field-name">Image</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () =>
                onChange({
                  ...object,
                  image: {
                    src: String(reader.result ?? ''),
                    width: object.transform.width,
                    height: object.transform.height,
                  },
                });
              reader.readAsDataURL(file);
            }}
          />
        </label>
      )}
      {object.type === 'group' && onUngroup && (
        <button className="props-delete" onClick={onUngroup}>
          Ungroup
        </button>
      )}
      {object.type === 'frame' && (
        <div className="props-section">
          <div className="props-section-title">Frame</div>
          <label className="props-field">
            <span className="props-field-name">Clip content</span>
            <input
              type="checkbox"
              checked={object.clip === true}
              onChange={(event) => onChange({ ...object, clip: event.target.checked })}
            />
          </label>
          <label className="props-field">
            <span className="props-field-name">Auto layout</span>
            <select
              value={object.layout?.direction ?? 'horizontal'}
              onChange={(event) =>
                patchLayout({
                  direction: event.target.value as 'horizontal' | 'vertical',
                })
              }
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
          {numField('Padding', object.layout?.padding ?? 0, (padding) => patchLayout({ padding }))}
          {numField('Gap', object.layout?.gap ?? 0, (gap) => patchLayout({ gap }))}
          <div className="props-align-row">
            <button className="props-align-btn" onClick={() => addChild('rect')}>
              + Rect
            </button>
            <button className="props-align-btn" onClick={() => addChild('oval')}>
              + Oval
            </button>
            <button className="props-align-btn" onClick={() => addChild('text')}>
              + Text
            </button>
            <button
              className="props-align-btn"
              onClick={() =>
                onChange({ ...object, children: (object.children ?? []).slice(0, -1) })
              }
              disabled={(object.children?.length ?? 0) === 0}
            >
              − Last
            </button>
          </div>
        </div>
      )}
      <div className="props-section">
        <div className="props-section-title">Simulation binding</div>
        <label className="props-field">
          <span className="props-field-name">Enabled</span>
          <input
            type="checkbox"
            checked={!!binding}
            onChange={(event) =>
              event.target.checked
                ? patchBinding({ width: 'queueLength * 10' })
                : onChange({ ...object, binding: undefined })
            }
          />
        </label>
        {binding && (
          <>
            <p className="side-hint">Variables: queueLength, busy, servers, downServers, tick</p>
            {(['width', 'height', 'opacity', 'x', 'y', 'rotation'] as const).map((key) => (
              <label className="props-field" key={key}>
                <span className="props-field-name">{key}</span>
                <input
                  type="text"
                  value={bindings[key] ?? ''}
                  placeholder="e.g. queueLength * 10"
                  onChange={(event) => patchBinding({ ...bindings, [key]: event.target.value })}
                />
              </label>
            ))}
          </>
        )}
      </div>
      {(onBringToFront || onSendToBack) && (
        <div className="props-section">
          <div className="props-section-title">Arrange</div>
          <div className="props-align-row">
            {onBringToFront && (
              <button className="props-align-btn" onClick={onBringToFront}>
                Bring to front
              </button>
            )}
            {onSendToBack && (
              <button className="props-align-btn" onClick={onSendToBack}>
                Send to back
              </button>
            )}
          </div>
        </div>
      )}
      {(alignIds?.length ?? 0) >= 2 && onAlign && (
        <div className="props-section">
          <div className="props-section-title">Align</div>
          <div className="props-align-row">
            {(
              [
                ['left', '←'],
                ['centerX', '↔'],
                ['right', '→'],
                ['top', '↑'],
                ['centerY', '↕'],
                ['bottom', '↓'],
              ] as const
            ).map(([axis, label]) => (
              <button
                key={axis}
                className="props-align-btn"
                title={axis}
                onClick={() => onAlign(axis)}
              >
                {label}
              </button>
            ))}
          </div>
          {(alignIds?.length ?? 0) >= 3 && onDistribute && (
            <div className="props-align-row" style={{ marginTop: 6 }}>
              <button
                className="props-align-btn"
                title="Distribute horizontally"
                onClick={() => onDistribute('horizontal')}
              >
                ⇔ H
              </button>
              <button
                className="props-align-btn"
                title="Distribute vertically"
                onClick={() => onDistribute('vertical')}
              >
                ⇕ V
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
