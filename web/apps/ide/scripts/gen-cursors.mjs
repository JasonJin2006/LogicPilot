// Generates the custom cursor SVGs (web/apps/ide/public/cursors) from lucide
// icons. Most cursors are the lucide shape rendered as a solid white fill
// with a thin dark outline. Hand-shaped cursors (grab / pointer) use a solid
// mode: their fingers are open stroke paths, so a thick white stroke paints
// the fingers solid (fill alone would leave them hollow).
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
  { name: 'cursor-pointer', icon: 'pointer', solid: true },
  { name: 'cursor-text', icon: 'text-cursor' },
  { name: 'cursor-grab', icon: 'hand', solid: true },
  { name: 'cursor-grabbing', icon: 'move' },
  { name: 'cursor-crosshair', icon: 'crosshair' },
  { name: 'cursor-resize-h', icon: 'move-horizontal' },
  { name: 'cursor-resize-v', icon: 'move-vertical' },
];

function renderSvg(iconNode, solid) {
  const shapes = iconNode
    .map(([tag, attrs]) => {
      const props = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${props}/>`;
    })
    .join('');
  if (solid) {
    // Thick white strokes (outlined by a wider dark stroke) fill the open
    // finger paths so the whole hand reads as a solid white silhouette.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
  <g fill="none" stroke="#10151d" stroke-width="5">${shapes}</g>
  <g fill="#ffffff" stroke="#ffffff" stroke-width="3.6">${shapes}</g>
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
  writeFileSync(path, renderSvg(iconNode, cursor.solid === true));
  console.log(`wrote ${path}`);
}
