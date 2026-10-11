// Kernel/method boundary scan: the platform core must not include a method's
// headers.
//
// Why this exists. Every formalism runtime (devs/agent/process/sd/statechart) is
// its own library behind its own LOGICPILOT_METHOD_* switch, and the kernel core
// never registers one itself (kernel/src/runtime/simulation_kernel.cpp: "the core
// never registers any itself"). That separation only holds while the core cannot
// reach into a method's headers: the moment it does, the method becomes
// unremovable - switching it off stops the core from linking - and "the core owns
// no formalism" degrades from a property into a comment. The rule was already
// stated in docs/roadmap.md; nothing checked it.
//
// What is checked. Every #include in kernel/src and kernel/include. An include is
// a violation when it resolves nowhere inside kernel/ while a header at the same
// relative path exists under methods/. That is a resolved-path rule rather than a
// name list, so it keeps working as methods gain headers, and it gets the
// ambiguous case right: methods/agent/agent_runtime.h and
// kernel/include/logicpilot/agent/agent_runtime.h share a basename, and the
// kernel's own is reached as "logicpilot/agent/agent_runtime.h" while the
// method's is only ever reached as a bare name.
//
// Resolution assumes kernel/include and the including file's own directory are
// searched before a method's include directory, which is the order the current
// target setup produces. A collision between the two sides is reported rather
// than silently decided, because that assumption is what the verdict rests on.
//
// Out of scope by design: kernel/apps/*. Those are the composition root - they
// call register_all_methods() and so must include method headers. The streaming
// gateway's per-formalism branch in lp-server is a contract question (how a model
// declares what telemetry it can produce), tracked separately from this scan.
//
// The scanner is a pure module so its own test can point it at a synthetic
// checkout; `check-kernel-boundary.mjs` is the gate that runs it on this one.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** Extensions treated as compilable sources on both sides of the boundary. */
const SOURCE_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'];

function isSource(name) {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** Every source file under `dir`, or none when the directory is absent, so a
 *  pruned checkout cannot make the gate report the wrong thing. */
function walkSources(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, found);
    else if (entry.isFile() && isSource(entry.name)) found.push(full);
  }
  return found;
}

/** Forward slashes throughout, so a rule written on POSIX separators holds on a
 *  Windows checkout too. */
function toPosix(path) {
  return path.split('\\').join('/');
}

function basenameOf(path) {
  const parts = toPosix(path).split('/');
  return parts[parts.length - 1];
}

/** The argument of an `#include` directive, or null for any other line. */
export function includeArgument(line) {
  const match = /^\s*#\s*include\s*[<"]([^>"]+)[>"\s]/.exec(line);
  return match === null ? null : match[1].trim();
}

/** True when `argument` finds a file inside the kernel tree: either through
 *  kernel/include (the public include root) or next to the including file, which
 *  is how intra-tree headers are reached today. */
function resolvesInsideKernel(includingFile, argument, root) {
  return (
    existsSync(join(root, 'kernel', 'include', argument)) ||
    existsSync(join(dirname(includingFile), argument))
  );
}

/**
 * Scans one checkout and reports every core include that only a method can
 * satisfy. `root` is the repository root.
 */
export function scanKernelBoundary(root) {
  const methodsRoot = join(root, 'methods');
  const methodHeaders = walkSources(methodsRoot);
  // Two shapes, because a method's include directory is the method's own folder
  // (`-Imethods/process`), so `#include "process_flow.h"` and
  // `#include "sub/process_flow.h"` are reachable in different ways.
  const methodRelative = new Set(
    methodHeaders.map((header) => toPosix(relative(methodsRoot, header))),
  );
  const methodBasenames = new Set(methodHeaders.map((header) => basenameOf(header)));

  const coreFiles = walkSources(join(root, 'kernel', 'src')).concat(
    walkSources(join(root, 'kernel', 'include')),
  );
  const coreNames = new Set(coreFiles.map((file) => basenameOf(file)));

  const violations = [];
  const ambiguous = new Set();
  let includes = 0;

  for (const file of coreFiles) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const argument = includeArgument(line);
      if (argument === null) continue;
      includes += 1;
      const normalized = toPosix(argument);
      const where = `${toPosix(relative(root, file))}:${index + 1}`;

      // An explicit path into methods/ is a violation whatever it resolves to.
      if (normalized.split('/').includes('methods')) {
        violations.push({ where, argument, reason: 'names methods/ in the include path' });
        continue;
      }
      if (resolvesInsideKernel(file, normalized, root)) continue;

      // A bare name reaches a method through that method's include directory; a
      // path has to match the method's own relative layout.
      const isMethodHeader = normalized.includes('/')
        ? methodRelative.has(normalized)
        : methodBasenames.has(normalized);
      if (!isMethodHeader) continue;

      // The same basename living on both sides makes the verdict depend on
      // search order, so a hit here is reported as ambiguous as well as a
      // violation - a reviewer should not have to rediscover that.
      if (coreNames.has(basenameOf(normalized))) ambiguous.add(normalized);
      violations.push({
        where,
        argument,
        reason: 'resolves only under methods/, which the core must not depend on',
      });
    }
  }

  return {
    violations,
    includes,
    coreFiles: coreFiles.length,
    methodHeaders: methodHeaders.length,
    ambiguous: [...ambiguous].sort(),
  };
}
