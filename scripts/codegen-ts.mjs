#!/usr/bin/env node
// Regenerates the TypeScript bindings for schemas/ir.fbs + schemas/wire.fbs
// into web/packages/protocol/src/generated (flatc --ts).
//
// Invoked by `pnpm codegen` at the repo root. flatc is located via:
//   1. $FLATC / $FLATC_EXECUTABLE env var,
//   2. .deps/flatc/flatc (scripts/fetch-flatc.ps1 download),
//   3. `flatc` on PATH (e.g. the vcpkg flatbuffers port tools dir).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const depsFlatc = join(root, '.deps', 'flatc', isWin ? 'flatc.exe' : 'flatc');

function findFlatc() {
  for (const envVar of ['FLATC', 'FLATC_EXECUTABLE']) {
    const fromEnv = process.env[envVar];
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
  }
  if (existsSync(depsFlatc)) return depsFlatc;
  return 'flatc';
}

const flatc = findFlatc();
const outDir = join(root, 'web', 'packages', 'protocol', 'src', 'generated');
const schemas = [join(root, 'schemas', 'ir.fbs'), join(root, 'schemas', 'wire.fbs')];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`[codegen-ts] using ${flatc}`);
const result = spawnSync(flatc, ['--ts', '-o', outDir, ...schemas], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(
    `[codegen-ts] failed to execute flatc (${result.error.message}). ` +
      'Run `pwsh scripts/fetch-flatc.ps1` or install the flatbuffers vcpkg port.',
  );
  process.exit(1);
}
if (result.status !== 0) {
  console.error('[codegen-ts] flatc --ts failed');
  process.exit(result.status ?? 1);
}
console.log(`[codegen-ts] OK -> ${outDir}`);
