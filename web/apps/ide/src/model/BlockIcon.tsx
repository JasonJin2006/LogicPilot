// Static block glyphs for the palette and the modeling canvas. These are the
// AnyLogic-style icons that replace the old text cards; flow blocks also
// expose in/out ports around their edges (see blockDefs.ts).

import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', width: '100%', height: '100%' }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function BlockIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'source':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M12 20h11" />
          <path d="M19 16l4 4-4 4" />
        </Glyph>
      );
    case 'queue':
      return (
        <Glyph>
          <rect x="8" y="8" width="24" height="6" rx="3" />
          <rect x="8" y="17" width="24" height="6" rx="3" />
          <rect x="8" y="26" width="24" height="6" rx="3" />
        </Glyph>
      );
    case 'service':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="7" />
          <circle cx="20" cy="20" r="7.5" />
          <path d="M20 15.5V20l3.5 2.5" />
        </Glyph>
      );
    case 'sink':
      return (
        <Glyph>
          <path d="M20 6v21" />
          <path d="M14 21l6 6 6-6" />
          <path d="M8 33h24" />
        </Glyph>
      );
    case 'resource':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="6" />
          <text
            x="20"
            y="25.5"
            textAnchor="middle"
            fontSize="15"
            fill="currentColor"
            stroke="none"
          >
            R
          </text>
        </Glyph>
      );
    case 'rect':
      return (
        <Glyph>
          <rect x="9" y="12" width="22" height="16" />
        </Glyph>
      );
    case 'roundedRect':
      return (
        <Glyph>
          <rect x="9" y="12" width="22" height="16" rx="4" />
        </Glyph>
      );
    case 'oval':
      return (
        <Glyph>
          <ellipse cx="20" cy="20" rx="13" ry="9" />
        </Glyph>
      );
    case 'line':
      return (
        <Glyph>
          <line x1="8" y1="28" x2="32" y2="12" />
        </Glyph>
      );
    case 'polyline':
      return (
        <Glyph>
          <polyline points="8,28 16,16 24,24 32,12" />
        </Glyph>
      );
    case 'arc':
      return (
        <Glyph>
          <path d="M9 24 A 11 11 0 1 1 31 16" />
        </Glyph>
      );
    case 'curve':
      return (
        <Glyph>
          <path d="M8 28 C 16 8, 24 32, 32 12" />
        </Glyph>
      );
    case 'text':
      return (
        <Glyph>
          <text x="20" y="25" textAnchor="middle" fontSize="16" fill="currentColor" stroke="none">
            T
          </text>
        </Glyph>
      );
    case 'image':
      return (
        <Glyph>
          <rect x="8" y="10" width="24" height="20" rx="2" />
          <path d="M12 24 l5-6 4 4 3-3 4 5" />
        </Glyph>
      );
    case 'group':
      return (
        <Glyph>
          <rect x="10" y="10" width="16" height="16" rx="2" />
          <rect x="16" y="16" width="16" height="16" rx="2" opacity="0.6" />
        </Glyph>
      );
    case 'state':
      return (
        <Glyph>
          <rect x="10" y="11" width="20" height="18" rx="9" />
        </Glyph>
      );
    case 'initialState':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="10" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'finalState':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <circle cx="20" cy="20" r="5" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'transition':
      return (
        <Glyph>
          <path d="M8 28 L30 12" />
          <path d="M25 11 L31 10 L30 16" />
        </Glyph>
      );
    case 'historyState':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="10" />
          <text x="20" y="25" textAnchor="middle" fontSize="13" fill="currentColor" stroke="none">
            H
          </text>
        </Glyph>
      );
    case 'branch':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="10" />
          <path d="M14 20 h12" />
        </Glyph>
      );
    case 'action':
      return (
        <Glyph>
          <rect x="8" y="12" width="24" height="16" rx="3" />
          <path d="M15 20 h10" />
          <path d="M21 16 l4 4 -4 4" />
        </Glyph>
      );
    case 'decision':
      return (
        <Glyph>
          <path d="M20 7 L33 20 L20 33 L7 20 Z" />
        </Glyph>
      );
    case 'whileLoop':
      return (
        <Glyph>
          <path d="M12 14 a8 8 0 1 0 16 0" />
          <path d="M12 14 V8" />
          <path d="M12 8 l-4 3 4 3" />
        </Glyph>
      );
    case 'forLoop':
      return (
        <Glyph>
          <path d="M10 20 a10 10 0 1 1 20 0" />
          <path d="M10 20 v-6" />
          <path d="M10 14 l-4 3 4 3" />
        </Glyph>
      );
    case 'doWhileLoop':
      return (
        <Glyph>
          <path d="M20 9 a11 11 0 1 0 0 22" />
          <path d="M20 9 v6" />
          <path d="M20 15 l-4 -3 4 -3" />
        </Glyph>
      );
    case 'break':
      return (
        <Glyph>
          <path d="M8 14 v12 h14" />
          <path d="M22 20 h8" />
          <path d="M26 16 l4 4 -4 4" />
        </Glyph>
      );
    case 'return':
      return (
        <Glyph>
          <path d="M24 8 v12 h-10" />
          <path d="M14 20 l4 -4 -4 -4" />
          <path d="M24 28 h-8" />
        </Glyph>
      );
    case 'localVariable':
      return (
        <Glyph>
          <rect x="9" y="12" width="22" height="16" rx="3" />
          <text x="20" y="25" textAnchor="middle" fontSize="14" fill="currentColor" stroke="none">
            x
          </text>
        </Glyph>
      );
    default:
      // Custom-library blocks fall back to a generic component glyph.
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="6" />
          <circle cx="20" cy="13" r="2" />
          <circle cx="14" cy="24" r="2" />
          <circle cx="26" cy="24" r="2" />
        </Glyph>
      );
  }
}
