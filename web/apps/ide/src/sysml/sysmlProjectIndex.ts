// Project-level SysML index: aggregates every .sysml source in the open
// workspace so definition/references lookups can cross file boundaries
// (plan §8 S1 "multi-file projects"). Identity stays per-file (qualified
// names are file-local); this index only answers LOOKUPS and never merges
// semantics - each file's projection remains the authority for its own
// canvas and layout sidecar.

import type { SysMLElement } from './sysmlProjection';
import { projectSysML } from './sysmlProjection';

export interface SysMLIndexedElement {
  path: string;
  element: SysMLElement;
}

export interface SysMLProjectIndex {
  files: Array<{ path: string; projection: ReturnType<typeof projectSysML> }>;
  byQualifiedName: Map<string, SysMLIndexedElement[]>;
  byName: Map<string, SysMLIndexedElement[]>;
  /** Diagnostics of every indexed file, tagged with the owning path. */
  diagnostics: Array<{
    path: string;
    code: string;
    severity: 'warning' | 'error';
    message: string;
    line?: number;
  }>;
}

const SYSML_SUFFIX = /\.sysml$/i;

export function buildSysMLProjectIndex(sources: Record<string, string>): SysMLProjectIndex {
  const files: SysMLProjectIndex['files'] = [];
  const byQualifiedName = new Map<string, SysMLIndexedElement[]>();
  const byName = new Map<string, SysMLIndexedElement[]>();
  const diagnostics: SysMLProjectIndex['diagnostics'] = [];
  const push = (
    map: Map<string, SysMLIndexedElement[]>,
    key: string,
    entry: SysMLIndexedElement,
  ) => {
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [entry]);
    else bucket.push(entry);
  };
  for (const [path, source] of Object.entries(sources)) {
    if (!SYSML_SUFFIX.test(path)) continue;
    const projection = projectSysML(source);
    files.push({ path, projection });
    for (const diagnostic of projection.diagnostics) {
      diagnostics.push({ path, ...diagnostic });
    }
    for (const element of projection.elements) {
      const entry: SysMLIndexedElement = { path, element };
      push(byQualifiedName, element.qualifiedName.toLowerCase(), entry);
      push(byName, element.name.toLowerCase(), entry);
    }
  }
  return { files, byQualifiedName, byName, diagnostics };
}

/** Unique-element resolution across the whole project: exact qualified
 *  name first, then bare name, then a unique ::name suffix. Ambiguous or
 *  missing queries resolve to nothing - callers must not guess. */
export function resolveInIndex(
  index: SysMLProjectIndex,
  query: string,
): SysMLIndexedElement | null {
  const normalized = query.trim().replace(/^::/, '').toLowerCase();
  if (normalized === '') return null;
  const exact = index.byQualifiedName.get(normalized);
  if (exact !== undefined && exact.length === 1) return exact[0]!;
  const byName = index.byName.get(normalized);
  // Unique across the project wins; anything else needs qualification.
  if (byName !== undefined) return byName.length === 1 ? byName[0]! : null;
  const suffix = [...index.byQualifiedName.entries()].filter(([key]) =>
    key.endsWith(`::${normalized}`),
  );
  return suffix.length === 1 ? suffix[0]![1][0]! : null;
}
