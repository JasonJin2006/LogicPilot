// Bundles the plugin-catalog scanner (and its frozen contracts + ajv
// validator) into a single Node ESM file. The staged desktop runtime ships
// ONLY this file: it has no repo node_modules, so bare package imports would
// break the app server at startup (see ADR-0071 §6 for the runtime layout).
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'dist', 'index.bundle.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});
console.log('[plugin-catalog] bundled dist/index.bundle.js');
