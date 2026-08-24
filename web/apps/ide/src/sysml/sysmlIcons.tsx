// SysML glyphs in the HOUSE icon style: same drawing system as BlockIcon
// (40x40 grid, 1.5 stroke, round caps/joins, currentColor, no fills) so the
// palette reads as one family - while every SHAPE stays SysML/UML canonical
// (tab-folder package, ellipse use case, stick-figure actor, compartment
// rectangles, ball-and-socket interface, boundary-square port). Keyword
// stereotypes live in the node text on canvas, not in these glyphs.

import type { SysMLVisualKind } from './sysmlProjection';

function Glyph({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Classifier block with a title compartment - the base SysML notation. */
function CompartmentBlock({ rows = 0, size = 12 }: { rows?: number; size?: number }) {
  return (
    <Glyph size={size}>
      <rect x={6} y={7} width={28} height={26} rx={2} />
      <path d="M6 15 H34" />
      {rows > 0 &&
        Array.from({ length: rows }, (_, index) => (
          <path key={index} d={`M11 ${20 + index * 5} H29`} strokeWidth={1.1} />
        ))}
    </Glyph>
  );
}

/** The standard SysML diagram frame: outer frame with title compartment. */
export function SysMLFileIcon({ size = 12 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x={4} y={7} width={32} height={26} rx={2} />
      <path d="M4 16 H20" />
    </Glyph>
  );
}

/** Per-kind element glyph: canonical shape, house stroke. */
export function SysMLElementIcon({ kind, size = 12 }: { kind: SysMLVisualKind; size?: number }) {
  switch (kind) {
    case 'package':
      // Tabbed folder.
      return (
        <Glyph size={size}>
          <rect x={5} y={14} width={30} height={19} rx={2} />
          <path d="M5 14 V8 H17 L21 14" />
        </Glyph>
      );
    case 'usecase':
      // Ellipse - actors are the stick figures, never the use case.
      return (
        <Glyph size={size}>
          <ellipse cx={20} cy={20} rx={16} ry={11.5} />
        </Glyph>
      );
    case 'stakeholder':
      // Actor stick figure.
      return (
        <Glyph size={size}>
          <circle cx={20} cy={9} r={4.5} />
          <path d="M20 13.5 V22 M12 17 H28 M20 22 L14 32 M20 22 L26 32" />
        </Glyph>
      );
    case 'state':
      // Rounded rectangle.
      return (
        <Glyph size={size}>
          <rect x={5} y={10} width={30} height={20} rx={10} />
        </Glyph>
      );
    case 'action':
      // Activity action: rounded rectangle.
      return (
        <Glyph size={size}>
          <rect x={5} y={10} width={30} height={20} rx={6} />
        </Glyph>
      );
    case 'calculation':
      // Rounded rect with a function divider.
      return (
        <Glyph size={size}>
          <rect x={5} y={10} width={30} height={20} rx={6} />
          <path d="M12 24 L17 19 M17 24 L12 19 M20 24 H28" strokeWidth={1.2} />
        </Glyph>
      );
    case 'requirement':
    case 'analysis':
    case 'verification':
      // «requirement» notation: title compartment over a text compartment.
      return <CompartmentBlock size={size} />;
    case 'constraint':
      return <CompartmentBlock size={size} />;
    case 'enum':
      // Enumeration: name compartment plus literal rows.
      return <CompartmentBlock rows={2} />;
    case 'port':
      // Full port: the small square on the boundary.
      return (
        <Glyph size={size}>
          <rect x={9} y={9} width={22} height={22} />
          <rect x={15.5} y={15.5} width={9} height={9} />
        </Glyph>
      );
    case 'interface':
      // Ball-and-socket (provided / required).
      return (
        <Glyph size={size}>
          <circle cx={12} cy={20} r={6} />
          <path d="M36 13.2 A6.8 6.8 0 0 0 36 26.8" />
          <path d="M18 20 H29" strokeWidth={1.2} />
        </Glyph>
      );
    case 'interaction':
      // Sequence frame: diagram frame with lifeline dashes.
      return (
        <Glyph size={size}>
          <rect x={4} y={7} width={32} height={26} rx={2} />
          <path d="M4 15 H18" />
          <path d="M20 22 V30 M28 22 V30" strokeWidth={1.1} strokeDasharray="3 3" />
        </Glyph>
      );
    case 'occurrence':
      // Occurrence: two offset snapshots on a stem.
      return (
        <Glyph size={size}>
          <rect x={8} y={12} width={18} height={14} rx={2} />
          <rect x={14} y={17} width={18} height={14} rx={2} />
        </Glyph>
      );
    case 'view':
    case 'viewpoint':
      // View: frame with a render diagonal.
      return (
        <Glyph size={size}>
          <rect x={6} y={7} width={28} height={26} rx={2} />
          <path d="M6 15 H16 M12 33 L28 15" strokeWidth={1.2} />
        </Glyph>
      );
    case 'item':
      // Flowing item: block with a through-arrow.
      return (
        <Glyph size={size}>
          <rect x={6} y={12} width={28} height={16} rx={2} />
          <path d="M11 20 H26 M23 16.5 L27 20 L23 23.5" strokeWidth={1.2} />
        </Glyph>
      );
    case 'flow':
      return (
        <Glyph size={size}>
          <path d="M6 20 H30 M27 15.5 L32 20 L27 24.5" />
        </Glyph>
      );
    case 'attribute':
      return (
        <Glyph size={size}>
          <rect x={6} y={13} width={28} height={14} rx={2} />
          <circle cx={12} cy={20} r={1.4} fill="currentColor" stroke="none" />
          <path d="M17 20 H29" strokeWidth={1.2} />
        </Glyph>
      );
    default:
      // part and any future kinds: the plain classifier block.
      return (
        <Glyph size={size}>
          <rect x={6} y={10} width={28} height={20} rx={2} />
        </Glyph>
      );
  }
}
