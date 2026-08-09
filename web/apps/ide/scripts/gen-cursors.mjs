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
      'M8 2a2 2 0 0 0-2 2v10l-.76-.76a2 2 0 0 0-2.83 2.83l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8v-3a2 2 0 0 0-3.77-.94A2 2 0 0 0 14.23 9 2 2 0 0 0 10 9V4a2 2 0 0 0-2-2Z',
    creases: [
      'M10 14V9a2 2 0 0 1 4 0v5',
      'M14 10a2 2 0 0 1 4 0v4',
      'M18 11a2 2 0 0 1 4 0',
      'M6 14l1 1',
    ],
  },
  grab: {
    outline:
      'M8 4a2 2 0 0 0-2 2v8l-.76-.76a2 2 0 0 0-2.83 2.83l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8V8a2 2 0 0 0-4-.08A2 2 0 0 0 14 6V4a2 2 0 0 0-4 0v2a2 2 0 0 0-2-2Z',
    creases: [
      'M10 14V6a2 2 0 0 1 4 0v8',
      'M14 8a2 2 0 0 1 4 0v6',
      'M18 8a2 2 0 0 1 4 0',
      'M6 14l1 1',
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
