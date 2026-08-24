// Standard SysML glyphs (OMG graphical notation, miniaturized): the file
// icon is the SysML diagram frame; element icons follow the per-kind node
// shapes used on the canvas (package tab, requirement ⓤ, action/state
// rounded blocks, use case ellipse, port sockets, constraint braces).

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

/** Per-kind element glyph matching the canvas's notation shapes. */
export function SysMLElementIcon({ kind, size = 12 }: { kind: SysMLVisualKind; size?: number }) {
  switch (kind) {
    case 'package':
      return (
        <Svg size={size}>
          <rect x={2} y={5.5} width={12} height={8} rx={0.6} />
          <path d="M2 5.5 V3 H6.6 L8.4 5.5" />
        </Svg>
      );
    case 'usecase':
      return (
        <Svg size={size}>
          <ellipse cx={8} cy={8} rx={6.6} ry={5.2} />
        </Svg>
      );
    case 'state':
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.6} width={12.4} height={8.8} rx={4.2} />
        </Svg>
      );
    case 'action':
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.6} width={12.4} height={8.8} rx={2.2} />
          <path d="M10.6 6.2 l2.4 1.5 l-2.4 1.5" />
        </Svg>
      );
    case 'requirement':
    case 'analysis':
    case 'verification':
      return (
        <Svg size={size}>
          <rect x={1.8} y={2.6} width={12.4} height={10.8} rx={0.8} />
          <circle cx={11} cy={11} r={3} strokeWidth={1} />
          <text
            x={11}
            y={12.9}
            textAnchor="middle"
            fontSize={5}
            fontWeight={700}
            stroke="none"
            fill="currentColor"
          >
            {kind === 'requirement' ? 'U' : kind === 'analysis' ? 'A' : 'V'}
          </text>
        </Svg>
      );
    case 'constraint':
      return (
        <Svg size={size}>
          <rect x={1.8} y={2.6} width={12.4} height={10.8} rx={0.8} />
          <text x={8} y={11} textAnchor="middle" fontSize={7} stroke="none" fill="currentColor">
            {'{ }'}
          </text>
        </Svg>
      );
    case 'port':
    case 'interface':
      return (
        <Svg size={size}>
          <rect x={2.4} y={2.4} width={11.2} height={11.2} />
          <rect x={5.6} y={5.6} width={4.8} height={4.8} fill="currentColor" stroke="none" />
        </Svg>
      );
    default:
      // part / item / attribute / enum / occurrence / view / viewpoint /
      // stakeholder / flow / unknown: the plain block.
      return (
        <Svg size={size}>
          <rect x={1.8} y={3.4} width={12.4} height={9.2} rx={0.8} />
        </Svg>
      );
  }
}
