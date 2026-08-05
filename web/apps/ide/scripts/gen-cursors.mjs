// Generates the custom cursor SVGs (web/apps/ide/public/cursors) from lucide
// icons. Most cursors are the lucide shape rendered as a solid white fill
// with a thin dark outline. Hand-shaped cursors (grab / pointer) keep the
// classic double-stroke look (white outline under a dark core): fill alone
// would leave their open finger paths hollow, and thick solid strokes turn
// the hand into an indistinct blob.
// Run from web/apps/ide:  node scripts/gen-cursors.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'cursors');

const CURSORS = [
  // The default arrow and the clickable pointer (pointing hand) extend the
  // themed set to the whole app, not just the canvas.
  { name: 'cursor-arrow', icon: 'mouse-pointer-2' },
  { name: 'cursor-pointer', icon: 'pointer', stroke: true },
  { name: 'cursor-text', icon: 'text-cursor' },
  { name: 'cursor-grab', icon: 'hand', stroke: true },
  { name: 'cursor-grabbing', icon: 'move' },
  { name: 'cursor-crosshair', icon: 'crosshair' },
  { name: 'cursor-resize-h', icon: 'move-horizontal' },
  { name: 'cursor-resize-v', icon: 'move-vertical' },
];

function renderSvg(iconNode, stroke) {
  const shapes = iconNode
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${props}/>`;
    })
    .join('');
  if (stroke) {
    // Classic double-stroke: a white outline under a thin dark core keeps
    // the line-art hand legible on both themes.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
  <g fill="none" stroke="#ffffff" stroke-width="2">${shapes}</g>
  <g fill="none" stroke="#10151d" stroke-width="1.2">${shapes}</g>
</svg>
`;
  }
  // Render at 16px with a viewBox of 24 so the icon matches the native
  // arrow's visual scale; solid white fill with a thin dark outline keeps
  // the cursor legible on both themes without hollow interiors.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
  <g fill="#ffffff" stroke="#10151d" stroke-width="1.2">${shapes}</g>
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
for (const cursor of CURSORS) {
  const module = await import(`lucide-react/dist/esm/icons/${cursor.icon}.mjs`);
  const iconNode = module.__iconNode;
  if (!Array.isArray(iconNode)) {
    throw new Error(`icon '${cursor.icon}' has no __iconNode`);
  }
  const path = join(outDir, `${cursor.name}.svg`);
  writeFileSync(path, renderSvg(iconNode, cursor.stroke === true));
  console.log(`wrote ${path}`);
}
