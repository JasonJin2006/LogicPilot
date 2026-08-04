// Static block glyphs for the palette and the modeling canvas. These are the
// AnyLogic-style icons that replace the old text cards; flow blocks also
// expose in/out ports around their edges (see blockDefs.ts).

import type { BlockKind } from '@logicpilot/editor';
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

export function BlockIcon({ kind }: { kind: BlockKind }) {
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
  }
}
