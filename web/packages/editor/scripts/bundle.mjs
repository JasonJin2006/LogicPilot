// Bundles the editor's server-safe model API (graph, patch replay, DSL
// generation) into a single Node ESM file. The staged desktop runtime ships
// ONLY this file: it has no repo node_modules, so bare imports such as
// polygon-clipping would break the app server (same layout rule as the
// plugin-catalog bundle in ADR-0071 §6).
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'dist', 'editor.bundle.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});
console.log('[editor] bundled dist/editor.bundle.js');
