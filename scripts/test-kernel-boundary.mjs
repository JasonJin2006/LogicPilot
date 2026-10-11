// Self-test for the kernel/method boundary gate.
//
// A gate that only ever runs against the tree it guards proves nothing: it would
// also pass if its scanner matched nothing at all. So this builds a synthetic
// checkout containing one violation of each shape the rule is supposed to catch,
// plus the near-misses it must NOT catch, and asserts the scanner separates them.
//
// Usage: node scripts/test-kernel-boundary.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { includeArgument, scanKernelBoundary } from './kernel-boundary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- the directive parser ----------------------------------------------------

assert.equal(includeArgument('#include "logicpilot/devs/flow_engine.h"'), 'logicpilot/devs/flow_engine.h');
assert.equal(includeArgument('  #  include <vector>'), 'vector');
assert.equal(includeArgument('#include"tight.h"'), 'tight.h');
// Not includes: they must not be counted as dependencies in either direction.
assert.equal(includeArgument('// #include "commented_out.h"'), null);
assert.equal(includeArgument('int x = 1;  // #include "trailing.h"'), null);
assert.equal(includeArgument('#define INCLUDED "a.h"'), null);
assert.equal(includeArgument(''), null);
console.log('  ok the directive parser accepts the real forms and ignores the lookalikes');

// --- a synthetic checkout ----------------------------------------------------

const fixture = mkdtempSync(join(tmpdir(), 'lp-kernel-boundary-'));
try {
  const write = (relativePath, contents) => {
    const full = join(fixture, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  };

  // The method side: two unambiguous names and one that collides with the
  // kernel's own header.
  write('methods/process/process_flow.h', '#pragma once\n');
  write('methods/process/process_runtime.h', '#pragma once\n');
  write('methods/agent/agent_runtime.h', '#pragma once\n');
  // The kernel side, including a header that shares the method's basename.
  write('kernel/include/logicpilot/devs/flow_engine.h', '#pragma once\n');
  write('kernel/include/logicpilot/agent/agent_runtime.h', '#pragma once\n');
  write('kernel/include/logicpilot/sibling.h', '#pragma once\n');

  // Legitimate: the core's own headers, reached by their full path, and a header
  // sitting next to the including file.
  write(
    'kernel/src/runtime/simulation_kernel.cpp',
    [
      '#include "logicpilot/devs/flow_engine.h"',
      '#include "logicpilot/agent/agent_runtime.h"',
      '#include <vector>',
      '',
    ].join('\n'),
  );
  write('kernel/src/runtime/local.h', '#pragma once\n#include "local.h"\n');

  // Violation 1: a bare name that only methods/ can satisfy - the ambiguous case.
  write('kernel/src/runtime/bad_bare.cpp', '#include "agent_runtime.h"\n');
  // Violation 2: a name that belongs to methods/ alone.
  write('kernel/src/runtime/bad_flow.cpp', '#include "process_flow.h"\n');
  // Violation 3: an explicit path into methods/.
  write(
    'kernel/include/logicpilot/bad_explicit.h',
    '#pragma once\n#include "../methods/process/process_runtime.h"\n',
  );
  // Violation 4: the same, reached through a directory component.
  write('kernel/src/runtime/bad_deep.cpp', '#include "methods/agent/agent_runtime.h"\n');

  // Out of scope by design: kernel/apps is the composition root and must be able
  // to include method headers to register them.
  write('kernel/apps/lp-server/server.cpp', '#include "process_flow.h"\n');
  // Not a source file at all, so never scanned.
  write('kernel/src/notes.md', '#include "process_flow.h"\n');

  const report = scanKernelBoundary(fixture);
  const flagged = report.violations.map((violation) => violation.where).sort();

  assert.deepEqual(
    flagged,
    [
      'kernel/include/logicpilot/bad_explicit.h:2',
      'kernel/src/runtime/bad_bare.cpp:1',
      'kernel/src/runtime/bad_deep.cpp:1',
      'kernel/src/runtime/bad_flow.cpp:1',
    ],
    `unexpected violations: ${JSON.stringify(report.violations)}`,
  );
  console.log('  ok every violation shape is caught (bare name, method-only name, explicit path)');

  assert.deepEqual(
    report.ambiguous,
    ['agent_runtime.h'],
    `a colliding basename must be reported as ambiguous: ${JSON.stringify(report.ambiguous)}`,
  );
  console.log('  ok a basename present on both sides is reported, not silently decided');

  const reasons = new Map(report.violations.map((v) => [v.where, v.reason]));
  assert.match(reasons.get('kernel/src/runtime/bad_deep.cpp:1') ?? '', /names methods\//);
  assert.match(reasons.get('kernel/src/runtime/bad_flow.cpp:1') ?? '', /only under methods\//);
  console.log('  ok the two rules report themselves distinctly');

  assert.deepEqual(
    report.violations.filter((violation) => violation.where.startsWith('kernel/apps/')),
    [],
    'kernel/apps is the composition root and must stay out of scope',
  );
  assert.equal(report.methodHeaders, 3);
  // Nine sources under kernel/src + kernel/include; the apps file and the .md are
  // not among them. The include count is what proves it: eight core includes,
  // while those two files would have made ten.
  assert.equal(report.coreFiles, 9);
  assert.equal(report.includes, 8, 'kernel/apps and non-source files must not be scanned');
  console.log('  ok kernel/apps and non-source files stay out of scope');

  // Reverse control: the scanner must not be trivially green - a tree with one
  // offending include reports exactly one violation and a different count.
  rmSync(join(fixture, 'kernel', 'src', 'runtime', 'bad_bare.cpp'));
  rmSync(join(fixture, 'kernel', 'src', 'runtime', 'bad_flow.cpp'));
  rmSync(join(fixture, 'kernel', 'src', 'runtime', 'bad_deep.cpp'));
  rmSync(join(fixture, 'kernel', 'include', 'logicpilot', 'bad_explicit.h'));
  const clean = scanKernelBoundary(fixture);
  assert.deepEqual(clean.violations, [], `clean tree still reports: ${JSON.stringify(clean)}`);
  assert.equal(clean.ambiguous.length, 0);
  assert.equal(clean.includes, report.includes - 4);
  console.log('  ok removing the offenders clears the report (the scan is not trivially green)');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// --- the real checkout -------------------------------------------------------

const real = scanKernelBoundary(root);
assert.ok(real.coreFiles > 20, `suspiciously few core files scanned: ${real.coreFiles}`);
assert.ok(real.includes > 100, `suspiciously few includes scanned: ${real.includes}`);
assert.deepEqual(
  real.violations,
  [],
  `the core reaches into methods/: ${JSON.stringify(real.violations)}`,
);
assert.ok(real.methodHeaders > 5, `suspiciously few method headers: ${real.methodHeaders}`);
console.log('  ok this checkout is inside the boundary');

console.log(
  `KERNEL-BOUNDARY TEST: PASS (${real.includes} includes / ${real.coreFiles} core files / ` +
    `${real.methodHeaders} method headers)`,
);
