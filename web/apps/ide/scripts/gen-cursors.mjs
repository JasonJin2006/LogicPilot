// Generates the custom cursor SVGs (web/apps/ide/public/cursors) from lucide
// icons. Every cursor renders as a solid white shape with a thin dark outline
// so the glyph stays legible on both themes. Lucide's hand icons are made of
// open strokes, which cannot be filled reliably, so pointer/grab use closed
// silhouettes with separate crease lines.
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
  { name: 'cursor-pointer', icon: 'pointer', hand: 'pointer' },
  { name: 'cursor-text', icon: 'text-cursor' },
  { name: 'cursor-grab', icon: 'hand', hand: 'grab' },
  { name: 'cursor-grabbing', icon: 'move' },
  { name: 'cursor-resize-h', icon: 'move-horizontal' },
  { name: 'cursor-resize-v', icon: 'move-vertical' },
];

const HANDS = {
  pointer: {
    outline:
      'M6.25 14.05v-9.8a2 2 0 0 1 4 0V10a2 2 0 0 1 4 0v.75A2 2 0 0 1 18 11.5v.25a2 2 0 0 1 3.75 1V14A7.75 7.75 0 0 1 14 21.75h-3.63c-1.6 0-3.14-.61-4.3-1.71l-3.9-3.69a2.14 2.14 0 0 1-.08-3.03 2.15 2.15 0 0 1 3.03-.08l1.13 1.07Z',
    creases: [
      'M10.25 14v-4',
      'M14.25 14v-3.25',
      'M18 14v-2.5',
      'M6.25 14.05l1.2 1.15',
    ],
  },
  grab: {
    outline:
      'M6.25 14.05V7a2 2 0 0 1 4 0V4.25a2 2 0 0 1 4 0V6a2 2 0 0 1 3.75 1 2 2 0 0 1 3.75 1v6A7.75 7.75 0 0 1 14 21.75h-3.63c-1.6 0-3.14-.61-4.3-1.71l-3.9-3.69a2.14 2.14 0 0 1-.08-3.03 2.15 2.15 0 0 1 3.03-.08l1.13 1.07Z',
    creases: [
      'M10.25 14V7',
      'M14.25 14V6',
      'M18 14V7',
      'M6.25 14.05l1.2 1.15',
    ],
  },
};

function renderSvg(iconNode, hand) {
  if (hand) {
    const paths = HANDS[hand];
    const creases = paths.creases.map((d) => `<path d="${d}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
  <path d="${paths.outline}" fill="#ffffff" stroke="#10151d" stroke-width="1.2"/>
  <g fill="none" stroke="#10151d" stroke-width="1.2">${creases}</g>
</svg>
`;
  }
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
  writeFileSync(path, renderSvg(iconNode, cursor.hand));
  console.log(`wrote ${path}`);
}
