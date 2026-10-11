#!/usr/bin/env node
// Gate: the platform core does not include a method runtime's headers.
// Rule and rationale live in kernel-boundary.mjs.
//
// Usage: node scripts/check-kernel-boundary.mjs   (exit 0 = inside the boundary)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanKernelBoundary } from './kernel-boundary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = scanKernelBoundary(root);

if (report.ambiguous.length > 0) {
  console.error(
    `[kernel-boundary] ${report.ambiguous.length} name(s) exist on both sides of the boundary: ` +
      report.ambiguous.join(', '),
  );
}

if (report.violations.length > 0) {
  console.error(`[kernel-boundary] ${report.violations.length} violation(s):`);
  for (const violation of report.violations) {
    console.error(`  - ${violation.where}: #include "${violation.argument}" ${violation.reason}`);
  }
  console.error(
    '[kernel-boundary] the core must not depend on a method runtime: move the shared piece into ' +
      'kernel/, or reach the method through the registry instead of its headers.',
  );
  process.exit(1);
}

console.log(
  `[kernel-boundary] OK: ${report.includes} includes across ${report.coreFiles} core files, ` +
    `none reaching into ${report.methodHeaders} method headers`,
);
