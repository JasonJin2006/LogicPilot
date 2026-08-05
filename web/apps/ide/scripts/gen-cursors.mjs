// Generates the custom cursor SVGs (web/apps/ide/public/cursors) from lucide
// icons. Each cursor is the lucide stroke rendered twice - a white outline
// under a dark core - so it stays visible on both the dark and light themes.
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
  { name: 'cursor-pointer', icon: 'pointer' },
  { name: 'cursor-text', icon: 'text-cursor' },
  { name: 'cursor-grab', icon: 'hand-grab' },
  { name: 'cursor-grabbing', icon: 'move' },
  { name: 'cursor-crosshair', icon: 'crosshair' },
  { name: 'cursor-resize-h', icon: 'move-horizontal' },
  { name: 'cursor-resize-v', icon: 'move-vertical' },
];

function renderSvg(iconNode) {
  const shapes = iconNode
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${props}/>`;
    })
    .join('');
  // Render at 16px with a viewBox of 24 so the icon matches the native
  // arrow's visual scale; the double stroke is thin (white outline under a
  // dark core) to keep it subtle and legible on both themes.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="#ffffff" stroke-width="2">${shapes}</g>
  <g stroke="#10151d" stroke-width="1.2">${shapes}</g>
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
  writeFileSync(path, renderSvg(iconNode));
  console.log(`wrote ${path}`);
}
