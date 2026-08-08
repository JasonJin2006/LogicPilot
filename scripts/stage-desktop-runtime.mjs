#!/usr/bin/env node
// Assemble the self-contained runtime tree consumed by the Tauri bundle.
// Output is restricted to build/ so cleanup cannot touch source/user data.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const buildRoot = join(root, 'build');

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function requireFile(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${label} not found: ${absolute}`);
  }
  return absolute;
}

function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute, relativePath));
    else if (entry.isFile()) files.push({ relativePath, absolute });
  }
  return files;
}

const output = resolve(argument('--out', join(buildRoot, 'desktop-runtime')));
const relativeOutput = relative(buildRoot, output);
if (relativeOutput === '' || relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) {
  throw new Error(`desktop runtime output must be a child of ${buildRoot}`);
}

const node = requireFile(argument('--node', process.execPath), 'Node executable');
const nodeVersion = execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, '').split('.')[0] ?? '', 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  throw new Error(`desktop runtime requires Node >= 20, got '${nodeVersion || 'unknown'}'`);
}
const lpcli = requireFile(
  argument('--lpcli', join(buildRoot, 'windows-msvc-release', 'kernel', 'apps', 'lpcli', 'lpcli.exe')),
  'lpcli release sidecar',
);
const lpserver = requireFile(
  argument('--lpserver', join(buildRoot, 'windows-msvc-release', 'kernel', 'lp-server.exe')),
  'lp-server release sidecar',
);

const requiredFiles = [
  'app/server.mjs',
  'scripts/ai-build.mjs',
  'scripts/ai-provider.mjs',
  'scripts/ai-optimize.mjs',
  'scripts/ai-explain.mjs',
  'scripts/ai-model-patch.mjs',
  'scripts/ai-query-metrics.mjs',
  'scripts/ai-compare-metrics.mjs',
  'scripts/optimize.mjs',
  'scripts/tool-paths.mjs',
  'scripts/verify-run.mjs',
  'web/apps/ide/scripts/ai-endpoint.mjs',
  'LICENSE',
];
for (const path of requiredFiles) requireFile(join(root, path), path);
const frontend = resolve(root, 'web', 'apps', 'ide', 'dist');
if (!existsSync(join(frontend, 'index.html'))) {
  throw new Error('IDE production build is missing; run pnpm --filter @logicpilot/ide build');
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const path of requiredFiles) copyFile(join(root, path), join(output, path));
cpSync(frontend, join(output, 'web', 'apps', 'ide', 'dist'), { recursive: true });
copyFile(node, join(output, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node'));
copyFile(lpcli, join(output, 'runtime', 'bin', process.platform === 'win32' ? 'lpcli.exe' : 'lpcli'));
copyFile(lpserver, join(output, 'runtime', 'bin', process.platform === 'win32' ? 'lp-server.exe' : 'lp-server'));

// CMake places required non-system runtime DLLs beside each release binary.
for (const directory of new Set([dirname(lpcli), dirname(lpserver)])) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // Skip test-only artifacts (e.g. logicpilot_test_cabi_plugin.dll) that
    // CMake copies beside the release binaries; they must not ship.
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll') &&
        !entry.name.toLowerCase().includes('test')) {
      copyFile(join(directory, entry.name), join(output, 'runtime', 'bin', entry.name));
    }
  }
}

const manifestFiles = filesUnder(output)
  .filter((entry) => entry.relativePath !== 'runtime-manifest.json')
  .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  .map((entry) => ({
    path: entry.relativePath.replaceAll('\\', '/'),
    bytes: statSync(entry.absolute).size,
    sha256: createHash('sha256').update(readFileSync(entry.absolute)).digest('hex'),
  }));
const manifest = {
  format: 1,
  platform: process.platform,
  architecture: process.arch,
  nodeVersion,
  createdAt: new Date().toISOString(),
  files: manifestFiles,
};
writeFileSync(join(output, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`DESKTOP-RUNTIME ${output}`);
console.log(`DESKTOP-RUNTIME-FILES ${manifestFiles.length}`);
