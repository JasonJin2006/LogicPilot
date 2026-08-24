// Standard SysML glyphs (OMG graphical notation, miniaturized). Shapes follow
// the official notation vocabulary: tabbed-folder package, ELLIPSE use case,
// stick-figure actor/stakeholder, rounded-rectangle states and actions,
// rectangle-with-title-compartment requirements («requirement», no invented
// letter badges), ball-and-socket interfaces (UML assembly notation),
// square ports, compartmented enumerations. The keyword text itself
// («part def» etc.) is rendered by the canvas node stereotypes, not these
// 16px glyphs.

import type { SysMLVisualKind } from './sysmlProjection';

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The standard SysML diagram frame: outer frame with a title compartment. */
export function SysMLFileIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x={1.5} y={2.5} width={13} height={11} rx={0.8} />
      <path d="M1.5 5.7 H8" />
    </Svg>
  );
}

/** Rectangle with a name-compartment separator - the base form behind
 *  «requirement» / «analysis» / «verification» / «constraint» notation. */
function CompartmentRect({ tag }: { tag: string }) {
  return (
    <Svg size={12}>
      <rect x={1.8} y={2.6} width={12.4} height={10.8} rx={0.8} />
      <path d="M1.8 6 H14.2" strokeWidth={0.9} />
      <text
        x={8}
        y={11.4}
        textAnchor="middle"
        fontSize={4.4}
        stroke="none"
        fill="currentColor"
      >
        {tag}
      </text>
    </Svg>
  );
}

/** Per-kind element glyph matching the canvas's notation shapes. */
export function SysMLElementIcon({ kind, size = 12 }: { kind: SysMLVisualKind; size?: number }) {
  switch (kind) {
    case 'package':
      // Tabbed folder (UML package).
      return (
        <Svg size={size}>
          <rect x={2} y={5.5} width={12} height={8} rx={0.6} />
          <path d="M2 5.5 V3 H6.6 L8.4 5.5" />
        </Svg>
      );
    case 'usecase':
      // Ellipse - the actor stick figure belongs to stakeholders, NOT here.
      return (
        <Svg size={size}>
          <ellipse cx={8} cy={8} rx={6.6} ry={5.2} />
        </Svg>
      );
    case 'state':
      // Rounded rectangle.
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.6} width={12.4} height={8.8} rx={4.2} />
        </Svg>
      );
    case 'action':
    case 'calculation':
      // Activity action: rounded rectangle (no play-arrow; that is media
      // player iconography, not OMG notation).
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.6} width={12.4} height={8.8} rx={2.2} />
        </Svg>
      );
    case 'requirement':
      return <CompartmentRect tag="«req»" />;
    case 'analysis':
      return <CompartmentRect tag="«an»" />;
    case 'verification':
      return <CompartmentRect tag="«ver»" />;
    case 'constraint':
      return <CompartmentRect tag="{ }" />;
    case 'port':
      // Full port: the small square on the boundary.
      return (
        <Svg size={size}>
          <rect x={3.4} y={3.4} width={9.2} height={9.2} />
          <rect x={6.2} y={6.2} width={3.6} height={3.6} fill="currentColor" stroke="none" />
        </Svg>
      );
    case 'interface':
      // Ball-and-socket (provided/required), the assembly notation an
      // interface definition binds.
      return (
        <Svg size={size}>
          <circle cx={4.6} cy={8} r={2.6} />
          <path d="M15.2 5.4 A2.6 2.6 0 0 0 15.2 10.6" />
          <path d="M7.2 8 H12.6" strokeWidth={0.9} />
        </Svg>
      );
    case 'enum':
      // Enumeration: name compartment plus literal rows.
      return (
        <Svg size={size}>
          <rect x={1.8} y={2.6} width={12.4} height={10.8} rx={0.8} />
          <path d="M1.8 6 H14.2" strokeWidth={0.9} />
          <path d="M4 8.4 H12 M4 11 H12" strokeWidth={0.8} strokeDasharray="2 1.6" />
        </Svg>
      );
    case 'stakeholder':
      // Actor stick figure.
      return (
        <Svg size={size}>
          <circle cx={8} cy={3.6} r={1.9} />
          <path d="M8 5.5 V10.4 M4.6 7.2 H11.4 M8 10.4 L5.4 13.8 M8 10.4 L10.6 13.8" />
        </Svg>
      );
    default:
      // part / item / attribute / occurrence / view / viewpoint / flow /
      // unknown: plain classifier block; the distinguishing keyword lives in
      // the node's stereotype text per the standard.
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.4} width={12.4} height={9.2} rx={0.8} />
        </Svg>
      );
  }
}
