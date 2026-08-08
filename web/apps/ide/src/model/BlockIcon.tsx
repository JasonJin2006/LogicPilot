// Static block glyphs for the palette and the modeling canvas. AnyLogic-style
// outline icons (40x40 grid, 1.5 stroke, round caps, no fills except sanctioned
// dots/triangles). Shape language: circle = terminal/event, rect = station,
// diamond = decision, triangle = split/combine, block arrow = enter/exit.
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
    // ── Process library ────────────────────────────────────────────────────
    case 'source':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <circle cx="14" cy="20" r="1.6" fill="currentColor" stroke="none" />
          <path d="M17.5 20h7.5" />
          <path d="M21.5 16.5l3.5 3.5-3.5 3.5" />
        </Glyph>
      );
    case 'sink':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M15.5 15.5l9 9" />
          <path d="M24.5 15.5l-9 9" />
        </Glyph>
      );
    case 'delay':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <circle cx="20" cy="20" r="5.5" />
          <path d="M20 17v3l2.5 2" />
        </Glyph>
      );
    case 'queue':
      return (
        <Glyph>
          <rect x="7" y="12" width="26" height="16" rx="2" />
          <path d="M14.5 16v8" />
          <path d="M20 16v8" />
          <path d="M25.5 16v8" />
        </Glyph>
      );
    case 'service':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M13.5 16v8" />
          <path d="M17.5 16v8" />
          <circle cx="25" cy="20" r="4.5" />
          <path d="M25 17.5v2.5l2 1.5" />
        </Glyph>
      );
    case 'seize':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M13.5 16v8" />
          <path d="M17.5 16v8" />
          <path d="M25 15.5l4.5 8h-9z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'release':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M20 24.5l-4.5-8h9z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'wait':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <ellipse cx="20" cy="20" rx="8" ry="5" />
          <circle cx="16" cy="20" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="20" cy="20" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="24" cy="20" r="1.3" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'hold':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <rect
            x="14"
            y="18.4"
            width="12"
            height="3.2"
            rx="1.6"
            fill="currentColor"
            stroke="none"
          />
        </Glyph>
      );
    case 'selectOutput':
      return (
        <Glyph>
          <path d="M20 8L31 20L20 32L9 20Z" />
        </Glyph>
      );
    case 'selectOutput5':
      return (
        <Glyph>
          <path d="M20 7L26 13L20 19L14 13Z" />
          <path d="M20 19v14" />
          <path d="M20 23h6" />
          <path d="M20 27h6" />
          <path d="M20 31h6" />
        </Glyph>
      );
    case 'selectOutputIn':
    case 'selectOutputOut':
      return (
        <Glyph>
          <path d="M20 9L31 20L20 31L9 20Z" />
          <path d="M20 9L9 20L20 31Z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'split':
      return (
        <Glyph>
          <path d="M12 12h16v16z" />
          <path d="M23 17.5v5" />
          <path d="M20.5 20h5" />
        </Glyph>
      );
    case 'combine':
      return (
        <Glyph>
          <path d="M12 12v16h16z" />
        </Glyph>
      );
    case 'match':
      return (
        <Glyph>
          <rect x="7" y="9" width="26" height="22" rx="2" />
          <path d="M12 15h7" />
          <path d="M12 13.5v3" />
          <path d="M19 13.5v3" />
          <path d="M12 25h7" />
          <path d="M12 23.5v3" />
          <path d="M19 23.5v3" />
          <path d="M26 15v10" />
          <path d="M26 20h4" />
        </Glyph>
      );
    case 'assembler':
      return (
        <Glyph>
          <rect x="11" y="7" width="18" height="26" rx="2" />
          <path d="M15.5 12v16" />
          <path d="M15.5 14h4" />
          <path d="M15.5 18h4" />
          <path d="M15.5 22h4" />
          <path d="M15.5 26h4" />
          <circle cx="24" cy="13" r="3.5" />
          <path d="M24 11v2l1.5 1" />
          <path d="M24 21l3 5h-6z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'moveTo':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M11.5 20h7" />
          <path d="M15 16.5l3.5 3.5-3.5 3.5" />
          <path d="M26.5 24V14" />
          <path d="M26.5 14h5v4h-5" />
        </Glyph>
      );
    case 'batch':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <circle cx="12.5" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="20.5" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <path d="M25 13.5v5" />
          <path d="M22.5 16l2.5 2.5L25 16" />
          <path d="M21 21.5v4h8v-4" />
        </Glyph>
      );
    case 'unbatch':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M11 21.5v4h8v-4" />
          <path d="M15 19v-5" />
          <path d="M12.5 16.5l2.5-2.5 2.5 2.5" />
          <circle cx="23" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="27" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="31" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'enter':
      return (
        <Glyph>
          <path d="M8 16h10v-5l10 9-10 9v-5H8z" />
          <circle cx="31" cy="20" r="1.6" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'exit':
      return (
        <Glyph>
          <circle cx="9" cy="20" r="1.6" fill="currentColor" stroke="none" />
          <path d="M14 16h8v-5l10 9-10 9v-5h-8z" />
        </Glyph>
      );
    case 'timeMeasureStart':
      return (
        <Glyph>
          <circle cx="15" cy="20" r="6" />
          <path d="M15 11v3" />
          <path d="M12.5 11h5" />
          <path d="M15 17.5v2.5l2 1.5" />
          <path d="M24 20h6" />
          <path d="M27 17l3.5 3-3.5 3" />
        </Glyph>
      );
    case 'timeMeasureEnd':
      return (
        <Glyph>
          <path d="M9 20h6" />
          <path d="M12 17l3.5 3-3.5 3" />
          <circle cx="25" cy="20" r="6" />
          <path d="M25 11v3" />
          <path d="M22.5 11h5" />
          <path d="M25 17.5v2.5l2 1.5" />
        </Glyph>
      );
    case 'resource':
    case 'resourcePool':
      return (
        <Glyph>
          <path d="M8 27v-6a3 3 0 0 1 3-3h3.5l3-3H29a3 3 0 0 1 3 3v9z" />
          <path d="M16 24v-4" />
          <path d="M14 21.5l2-2.5 2 2.5" />
          <path d="M24 24v-4" />
          <path d="M22 21.5l2-2.5 2 2.5" />
        </Glyph>
      );
    case 'resourceTaskStart':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="8" />
          <path d="M17.5 16l5 4-5 4" />
        </Glyph>
      );
    case 'resourceTaskEnd':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="8" />
          <path d="M16 20l3 3 6-6" />
        </Glyph>
      );
    case 'resourceSendTo':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M12.5 24v-2a4 4 0 0 1 4-4h7" />
          <path d="M20 15l3.5 3-3.5 3" />
        </Glyph>
      );
    case 'downtime':
      return (
        <Glyph>
          <rect x="8" y="10" width="24" height="20" rx="2" />
          <path d="M21.5 14.5a4 4 0 1 0 4 4" />
          <path d="M22 21l-6 5" />
        </Glyph>
      );
    case 'pickup':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <circle cx="13" cy="24" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="17" cy="24" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="21" cy="24" r="1.3" fill="currentColor" stroke="none" />
          <path d="M26 24v-8" />
          <path d="M23.5 18.5l2.5-2.5 2.5 2.5" />
        </Glyph>
      );
    case 'dropoff':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M26 15v8" />
          <path d="M23.5 20.5l2.5 2.5 2.5-2.5" />
          <circle cx="13" cy="24" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="17" cy="24" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="21" cy="24" r="1.3" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'restrictedAreaStart':
      return (
        <Glyph>
          <path d="M25 12h-4v16h4" />
          <path d="M10 20h9" />
          <path d="M16 17l3.5 3-3.5 3" />
        </Glyph>
      );
    case 'restrictedAreaEnd':
      return (
        <Glyph>
          <path d="M15 12h4v16h-4" />
          <path d="M21 20h9" />
          <path d="M27 17l3.5 3-3.5 3" />
        </Glyph>
      );
    case 'resourceAttach':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M23.5 16.5l-5 5a2.3 2.3 0 0 0 3.3 3.3l5-5a3.9 3.9 0 0 0-5.5-5.5l-5 5" />
        </Glyph>
      );
    case 'resourceDetach':
      return (
        <Glyph>
          <rect x="7" y="11" width="26" height="18" rx="2" />
          <path d="M22.5 14.5l-4.5 4.5a2.1 2.1 0 0 0 3 3l4.5-4.5a3.5 3.5 0 0 0-5-5l-4.5 4.5" />
          <path d="M15 21v5" />
          <path d="M13 24l2 2 2-2" />
        </Glyph>
      );
    case 'pMLSettings':
      return (
        <Glyph>
          <rect x="8" y="8" width="24" height="24" rx="3" />
          <circle cx="20" cy="20" r="4" />
          <path d="M20 12v2.5" />
          <path d="M20 25.5V28" />
          <path d="M12 20h2.5" />
          <path d="M25.5 20H28" />
          <path d="M14.5 14.5l1.8 1.8" />
          <path d="M23.7 23.7l1.8 1.8" />
          <path d="M25.5 14.5l-1.8 1.8" />
          <path d="M16.3 23.7l-1.8 1.8" />
        </Glyph>
      );
    case 'plainTransfer':
      return (
        <Glyph>
          <path d="M10 20h20" />
          <circle cx="10" cy="20" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="30" cy="20" r="1.6" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'count':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M15 15v10" />
          <path d="M20 15v10" />
          <path d="M25 15v10" />
        </Glyph>
      );
    case 'process':
      return (
        <Glyph>
          <path d="M7 11h9l3 3h14v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
          <path d="M7 16h26" opacity="0.55" />
        </Glyph>
      );
    // ── Presentation / statechart / action: unchanged ─────────────────────
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
    case 'frame':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="3" />
          <rect x="12" y="12" width="16" height="16" rx="2" strokeDasharray="4 3" opacity="0.7" />
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
    // ── Agent library ────────────────────────────────────────────────────
    case 'parameter':
      return (
        <Glyph>
          <rect x="10" y="10" width="20" height="20" rx="4" />
          <text x="20" y="26" textAnchor="middle" fontSize="14" fill="currentColor" stroke="none">
            P
          </text>
        </Glyph>
      );
    case 'event':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M20 13v7l5 3" />
        </Glyph>
      );
    case 'dynamicEvent':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M20 13v7" />
          <circle cx="20" cy="20" r="2" fill="currentColor" stroke="none" />
          <path d="M20 24v3" />
        </Glyph>
      );
    case 'variable':
      return (
        <Glyph>
          <rect x="10" y="10" width="20" height="20" rx="4" />
          <text x="20" y="26" textAnchor="middle" fontSize="14" fill="currentColor" stroke="none">
            x
          </text>
        </Glyph>
      );
    case 'collection':
      return (
        <Glyph>
          <rect x="8" y="10" width="8" height="20" rx="1" />
          <rect x="16" y="10" width="8" height="14" rx="1" />
          <rect x="24" y="10" width="8" height="8" rx="1" />
        </Glyph>
      );
    case 'function':
      return (
        <Glyph>
          <rect x="7" y="10" width="26" height="20" rx="4" />
          <text x="20" y="25" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none">
            f(x)
          </text>
        </Glyph>
      );
    case 'tableFunction':
      return (
        <Glyph>
          <rect x="8" y="9" width="24" height="22" rx="2" />
          <path d="M8 17h24" />
          <path d="M8 25h24" />
          <path d="M14 9v13" />
          <path d="M21 9v13" />
          <path d="M14 21l4-3 3 2 5-5" />
        </Glyph>
      );
    case 'customDistribution':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M10 30v-6" />
          <path d="M16 30v-12" />
          <path d="M22 30v-16" />
          <path d="M28 30v-10" />
          <path d="M12 18c3-6 5-6 7-2s5 4 8-2" />
        </Glyph>
      );
    case 'schedule':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="11" />
          <path d="M20 14v6l4 3" />
          <path d="M14 8v4" />
          <path d="M26 8v4" />
        </Glyph>
      );
    case 'port':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="9" />
          <path d="M14 20h9" />
          <path d="M19 16.5l3.5 3.5-3.5 3.5" />
        </Glyph>
      );
    case 'connector':
      return (
        <Glyph>
          <circle cx="11" cy="20" r="3" />
          <circle cx="29" cy="20" r="3" />
          <path d="M14 20h12" />
        </Glyph>
      );
    case 'linkToAgents':
      return (
        <Glyph>
          <circle cx="10" cy="20" r="3" />
          <circle cx="30" cy="20" r="3" />
          <path d="M13 20h12" />
          <path d="M21 16.5l3.5 3.5-3.5 3.5" />
        </Glyph>
      );
    // ── Statechart additions ─────────────────────────────────────────────
    case 'statechart':
      return (
        <Glyph>
          <rect x="6" y="8" width="28" height="24" rx="4" />
          <circle cx="13" cy="20" r="2" fill="currentColor" stroke="none" />
          <path d="M15 20h3" />
          <rect x="18" y="15" width="14" height="10" rx="5" />
        </Glyph>
      );
    case 'statechartEntryPoint':
      return (
        <Glyph>
          <circle cx="12" cy="20" r="4" fill="currentColor" stroke="none" />
          <path d="M16 20h12" />
          <path d="M24 16l4 4-4 4" />
        </Glyph>
      );
    case 'initialStatePointer':
      return (
        <Glyph>
          <circle cx="12" cy="20" r="3" fill="currentColor" stroke="none" />
          <path d="M15 20h10" />
          <path d="M21 16.5l3.5 3.5-3.5 3.5" />
        </Glyph>
      );
    // ── Analysis library ─────────────────────────────────────────────────
    case 'dataSet':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="2" />
          <path d="M7 17h26" />
          <path d="M17 7v26" />
          <circle cx="12" cy="25" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="21" cy="21" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="29" cy="15" r="1.5" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'statistics':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M10 30v-14" />
          <path d="M16 30v-20" />
          <path d="M22 30v-16" />
          <path d="M28 30v-10" />
          <path d="M8 22h24" strokeDasharray="3 2" />
        </Glyph>
      );
    case 'histogramData':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M10 30v-8" />
          <path d="M16 30v-14" />
          <path d="M22 30v-18" />
          <path d="M28 30v-11" />
        </Glyph>
      );
    case 'histogram2DData':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="2" />
          <path d="M7 17h26" />
          <path d="M17 7v26" />
          <path d="M10 28v-4" />
          <path d="M14 28v-7" />
          <path d="M21 28v-5" />
          <path d="M26 28v-9" />
          <path d="M28 12v3" />
          <path d="M28 18v3" />
        </Glyph>
      );
    case 'output':
      return (
        <Glyph>
          <rect x="9" y="13" width="18" height="14" rx="2" />
          <path d="M27 20h7" />
          <path d="M30 16.5l3.5 3.5-3.5 3.5" />
        </Glyph>
      );
    case 'barChart':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <path d="M12 30v-8" />
          <path d="M19 30v-14" />
          <path d="M26 30v-18" />
        </Glyph>
      );
    case 'stackChart':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <path d="M12 30v-8" />
          <path d="M19 30v-14" />
          <path d="M26 30v-18" />
          <path d="M12 22h14" />
          <path d="M19 16h7" />
        </Glyph>
      );
    case 'pieChart':
      return (
        <Glyph>
          <circle cx="20" cy="20" r="12" />
          <path d="M20 20v-12a12 12 0 0 1 8.5 4.9z" fill="currentColor" stroke="none" />
          <path d="M20 20l8.5-7.1" />
        </Glyph>
      );
    case 'plot':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <circle cx="13" cy="24" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="20" cy="18" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="27" cy="12" r="1.8" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'timePlot':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <path d="M8 25l7-4 6 2 9-9" />
          <circle cx="8" cy="25" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="21" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="21" cy="23" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="30" cy="14" r="1.6" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'timeStackChart':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <path d="M8 26l7-4 6 2 9-9v15z" />
          <path d="M8 21l7-4 6 2 9-6" />
        </Glyph>
      );
    case 'timeColorChart':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <rect x="8" y="22" width="7" height="8" fill="currentColor" stroke="none" opacity="0.9" />
          <rect
            x="15"
            y="16"
            width="6"
            height="14"
            fill="currentColor"
            stroke="none"
            opacity="0.6"
          />
          <rect
            x="21"
            y="24"
            width="9"
            height="6"
            fill="currentColor"
            stroke="none"
            opacity="0.35"
          />
        </Glyph>
      );
    case 'histogram':
      return (
        <Glyph>
          <path d="M8 30h24" />
          <path d="M8 8v22" />
          <path d="M10 30v-7" />
          <path d="M16 30v-13" />
          <path d="M22 30v-17" />
          <path d="M28 30v-10" />
          <path d="M11 16c3-5 5-5 7-1s5 3 8-2" />
        </Glyph>
      );
    case 'histogram2D':
      return (
        <Glyph>
          <rect x="7" y="7" width="26" height="26" rx="2" />
          <path d="M7 17h26" />
          <path d="M17 7v26" />
          <path d="M10 28v-4" />
          <path d="M14 28v-8" />
          <path d="M21 28v-6" />
          <path d="M26 28v-10" />
        </Glyph>
      );
    // ── Controls library ─────────────────────────────────────────────────
    case 'button':
      return (
        <Glyph>
          <rect x="7" y="13" width="26" height="14" rx="4" />
          <text x="20" y="24" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">
            OK
          </text>
        </Glyph>
      );
    case 'checkBox':
      return (
        <Glyph>
          <rect x="10" y="15" width="10" height="10" rx="2" />
          <path d="M12.5 20l2 2 3-4" />
          <path d="M24 19h6" />
        </Glyph>
      );
    case 'editBox':
      return (
        <Glyph>
          <rect x="7" y="14" width="26" height="12" rx="2" />
          <path d="M12 20h8" />
          <path d="M25 20v5" />
        </Glyph>
      );
    case 'radioButtons':
      return (
        <Glyph>
          <circle cx="12" cy="14" r="3" />
          <circle cx="12" cy="20" r="3" />
          <circle cx="12" cy="26" r="3" fill="currentColor" stroke="none" />
          <path d="M19 14h9" />
          <path d="M19 20h9" />
          <path d="M19 26h9" />
        </Glyph>
      );
    case 'slider':
      return (
        <Glyph>
          <path d="M8 20h24" />
          <circle cx="14" cy="20" r="4" />
          <path d="M12 15l4-4" />
        </Glyph>
      );
    case 'comboBox':
      return (
        <Glyph>
          <rect x="7" y="13" width="26" height="9" rx="2" />
          <path d="M7 22l5 5 5-5" />
          <rect x="7" y="22" width="26" height="8" rx="2" />
        </Glyph>
      );
    case 'listBox':
      return (
        <Glyph>
          <rect x="8" y="9" width="24" height="22" rx="2" />
          <path d="M12 15h16" />
          <path d="M12 20h16" />
          <path d="M12 25h10" />
        </Glyph>
      );
    case 'fileChooser':
      return (
        <Glyph>
          <path d="M8 12h9l3 4h12v14H8z" />
          <path d="M8 22h24" />
        </Glyph>
      );
    case 'progressBar':
      return (
        <Glyph>
          <rect x="7" y="16" width="26" height="8" rx="4" />
          <rect x="9" y="18" width="16" height="4" rx="2" fill="currentColor" stroke="none" />
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
