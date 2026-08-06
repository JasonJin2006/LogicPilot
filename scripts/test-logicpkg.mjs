#!/usr/bin/env node
// CI smoke for logicpkg (P2): init -> pack -> install -> list round trip.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, 'logicpkg.mjs');
const node = process.execPath;

function run(args) {
  return execFileSync(node, [pkg, ...args], { encoding: 'utf8' });
}

const dir = mkdtempSync(join(tmpdir(), 'logicpkg-'));
try {
  const lib = join(dir, 'lib');
  const pkgPath = join(dir, 'out.lpkg');
  const target = join(dir, 'installed');

  run(['init', lib, '--name', 'demo']);
  if (!existsSync(join(lib, 'library.lplib'))) {
    throw new Error('init did not scaffold library.lplib');
  }
  run(['pack', lib, '-o', pkgPath]);
  run(['install', pkgPath, '--dir', target]);
  const installed = readFileSync(join(target, 'library.lplib'), 'utf8');
  if (!installed.includes('library demo')) {
    throw new Error('round trip lost the library declaration');
  }
  const listed = run(['list', pkgPath]);
  if (!listed.includes('library.lplib') || !listed.includes('palette.json')) {
    throw new Error('list did not enumerate package files');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('LOGICPKG TEST: PASS');
