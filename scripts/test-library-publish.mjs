#!/usr/bin/env node
// CI smoke for the industry-library publish loop (P3): logicpkg pack the
// manufacturing library -> install into a temp dir -> lpcli compile + run a
// model that `use manufacturing` (custom blocks Machine/Station).
//
// Usage: node scripts/test-library-publish.mjs [--lpcli <path>]
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const node = process.execPath;
const flag = process.argv.indexOf('--lpcli');
const lpcli = flag >= 0 ? process.argv[flag + 1] : 'lpcli';
const logicpkg = join(here, 'logicpkg.mjs');

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

const dir = mkdtempSync(join(tmpdir(), 'lp-publish-'));
let passed = false;
try {
  const pkgPath = join(dir, 'manufacturing.lpkg');
  const installed = join(dir, 'installed');
  // Wrap the single-file library in a package directory (manifest + lplib
  // + palette) before packing.
  const pkgDir = join(dir, 'pkg');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'manufacturing.lplib'),
    readFileSync(join(root, 'libraries', 'manufacturing.lplib'), 'utf8'),
    'utf8',
  );
  writeFileSync(
    join(pkgDir, 'palette.json'),
    '{"library":"manufacturing","blocks":[]}\n',
    'utf8',
  );
  run(node, [logicpkg, 'pack', pkgDir, '-o', pkgPath]);
  run(node, [logicpkg, 'install', pkgPath, '--dir', installed]);
  if (!existsSync(join(installed, 'manufacturing.lplib'))) {
    throw new Error('install did not produce manufacturing.lplib');
  }

  const model = join(dir, 'line.lp');
  writeFileSync(
    model,
    'model Line {\n' +
      '  use manufacturing\n' +
      '  resource Pool { capacity = 1 }\n' +
      '  source In { arrival = rate(0.5) }\n' +
      '  Station Q { capacity = 100 }\n' +
      '  Machine M { resource = Pool; time = exponential(1.0) }\n' +
      '  sink Done { }\n' +
      '  couple In.out -> Q.in\n' +
      '  couple Q.out -> M.in\n' +
      '  couple M.out -> Done.in\n' +
      '}\n',
    'utf8',
  );
  const ir = join(dir, 'line.ir.bin');
  run(lpcli, ['compile', model, '--lib-path', installed, '-o', ir]);
  run(lpcli, [
    'run', '--model-file', ir,
    '--seed', '42', '--reps', '2', '--arrivals', '300', '--warmup', '30',
  ]);
  passed = true;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!passed) {
  console.error('LIBRARY-PUBLISH TEST: FAIL');
  process.exit(1);
}
console.log('LIBRARY-PUBLISH TEST: PASS');
