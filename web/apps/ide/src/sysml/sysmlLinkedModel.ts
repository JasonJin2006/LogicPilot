// Linked multi-file SysML model (plan §8 S1 "multi-file projects").
//
// Each .sysml file remains an independent compilation unit - its own
// projection, layout sidecar, execution spans and evidence journal. This
// layer computes the IMPORT CLOSURE of the opened file (which other files'
// packages it pulls in, transitively) and produces one merged visualization
// projection so references like `part x : '飞行器'` resolve against the file
// that actually defines `'飞行器'`, instead of warning SY0002.
//
// Resolution tiers for a reference that failed locally, mirroring the
// single-file rules then widening them:
//   1. exact qualified name anywhere in the closure;
//   2. unique `::<name>` suffix inside a package this file explicitly
//      imports (respects `private import 'Pkg'::*;` scoping);
//   3. unique bare-name/suffix across the whole closure (old convenience).
// Anything still ambiguous or missing keeps its SY0002 warning - never a
// guess. Execution semantics deliberately stay per-file: spans index into
// their own source text, so Run/Lower always use the owning unit.

import { dequoteRef, fnv1aHex, parseSysMLSource } from './sysmlParser';
import type { SysMLParseResult } from './sysmlParser';
import { isStdLibraryReference, resolveParsedSysML } from './sysmlProjection';
import type {
  SysMLElement,
  SysMLProjection,
  SysMLProjectionDiagnostic,
  SysMLRelation,
} from './sysmlProjection';

export interface SysMLFileUnit {
  path: string;
  source: string;
  /** Per-file projection - the authority for this file's canvas, execution
   *  targets and lowering. */
  projection: SysMLProjection;
  /** True when this file's CURRENT text has error-level diagnostics. The
   *  unit then holds its last valid snapshot (previous text included) so
   *  one broken file cannot destabilize the whole linked canvas. */
  dirty: boolean;
}

export interface SysMLLinkedModel {
  /** Files in the import closure of the entry file, deterministic order
   *  (sorted, then breadth-first). Always includes the entry file itself. */
  units: SysMLFileUnit[];
  entryPath: string;
  /** Merged visualization projection across every unit. */
  projection: SysMLProjection;
  /** elementId -> owning file path (canvas go-to-source, origin badges). */
  origins: Record<string, string>;
}

const SYSML_SUFFIX = /\.sysml$/i;

/** One import directive's visible root: `private import 'Pkg'::'Sub'::*;`
 *  contributes the qualified prefix `'Pkg'::'Sub'`. Block comments are NOT
 *  tracked here - an import inside a doc comment yields at worst a harmless
 *  extra closure edge. */
const IMPORT_LINE =
  /^[ \t]*(?:(?:private|public|protected|abstract)\s+)*import\s+([^;]+);/;

export function importedPrefixes(source: string): string[] {
  const prefixes: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.trimStart().startsWith('//')) continue;
    const match = IMPORT_LINE.exec(line);
    if (!match) continue;
    for (const item of match[1]!.split(',')) {
      const base = item.trim().replace(/::\*?\*?$/, '');
      if (base === '') continue;
      prefixes.push(dequoteRef(base));
    }
  }
  return prefixes;
}

export function sysmlSourcesOf(sources: Record<string, string>): string[] {
  return Object.keys(sources)
    .filter((path) => SYSML_SUFFIX.test(path))
    .sort();
}

/** Import closure of `entryPath`: file G joins when some already-included
 *  file imports a qualified prefix naming a package declared in G.
 *  Deterministic (sorted candidates, breadth-first). */
export function sysmlImportClosure(
  entryPath: string,
  sources: Record<string, string>,
  prepared?: ReadonlyMap<string, SysMLParseResult>,
): string[] {
  const paths = sysmlSourcesOf(sources);
  if (!paths.includes(entryPath)) return [entryPath];
  const parsedByPath = new Map<string, SysMLParseResult>();
  for (const path of paths) {
    parsedByPath.set(path, prepared?.get(path) ?? parseSysMLSource(sources[path] ?? ''));
  }
  const included = new Set<string>([entryPath]);
  const queue = [entryPath];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const prefixes = importedPrefixes(sources[current] ?? '');
    if (prefixes.length === 0) continue;
    for (const next of paths) {
      if (included.has(next)) continue;
      const declares = new Set(
        [...parsedByPath.get(next)!.elements]
          .filter((element) => element.kind === 'package')
          .map((element) => element.qualifiedName),
      );
      if (prefixes.some((prefix) => declares.has(prefix))) {
        included.add(next);
        queue.push(next);
      }
    }
  }
  return paths.filter((path) => included.has(path));
}

/** Build the linked model: per-file units for the import closure plus the
 *  merged visualization projection. Each file is parsed exactly once per
 *  build. `previous` enables per-file last-valid retention - a file whose
 *  new text no longer parses keeps its previous unit (marked dirty) instead
 *  of dragging the shared canvas down with it. */
export function buildLinkedSysMLModel(
  entryPath: string,
  sources: Record<string, string>,
  previous?: ReadonlyMap<string, SysMLFileUnit>,
): SysMLLinkedModel {
  const paths = sysmlSourcesOf(sources);
  const parsedByPath = new Map<string, SysMLParseResult>();
  for (const path of paths) {
    parsedByPath.set(path, parseSysMLSource(sources[path] ?? ''));
  }
  const closure = sysmlImportClosure(entryPath, sources, parsedByPath);

  const units: SysMLFileUnit[] = closure.map((path) => {
    const source = sources[path] ?? '';
    const projection = resolveParsedSysML(source, parsedByPath.get(path)!);
    const fresh: SysMLFileUnit = {
      path,
      source,
      projection,
      dirty: projection.diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    };
    const prior = previous?.get(path);
    if (fresh.dirty && prior !== undefined && !prior.dirty) {
      return { ...prior, dirty: true };
    }
    return fresh;
  });

  // --- merged elements -------------------------------------------------
  const elements: SysMLElement[] = [];
  const origins: Record<string, string> = {};
  const usedIds = new Set<string>();
  // unit path -> (per-file element id -> merged id); identity matches except
  // when two files declare the same kind+qualified name (fragmented
  // namespaces) and later files get a deterministic disambiguation suffix.
  const idAliases = new Map<string, Map<string, string>>();
  const mergedByQualified = new Map<string, SysMLElement[]>();
  const pushQualified = (key: string, element: SysMLElement) => {
    const bucket = mergedByQualified.get(key);
    if (bucket === undefined) mergedByQualified.set(key, [element]);
    else bucket.push(element);
  };
  for (const unit of units) {
    const aliases = new Map<string, string>();
    idAliases.set(unit.path, aliases);
    for (const element of unit.projection.elements) {
      let id = element.id;
      if (usedIds.has(id)) id = `${id}-${fnv1aHex(unit.path).slice(0, 6)}`;
      const merged: SysMLElement = { ...element, id };
      usedIds.add(id);
      elements.push(merged);
      origins[id] = unit.path;
      aliases.set(element.id, id);
      pushQualified(element.qualifiedName.toLowerCase(), merged);
    }
  }

  // --- relations: local first, then cross-file tiers --------------------
  const mergedById = new Map(elements.map((element) => [element.id, element]));
  const relations: SysMLRelation[] = [];
  const relationKeys = new Set<string>();
  const diagnostics: SysMLProjectionDiagnostic[] = [];
  const tagged = units.length > 1;
  const addRelation = (
    kind: SysMLRelation['kind'],
    from: SysMLElement,
    to: SysMLElement,
    label: string,
    line: number,
    trigger?: SysMLRelation['trigger'],
  ) => {
    const key = `${kind}:${from.id}:${to.id}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push({
      id: `sysml-rel-${fnv1aHex(`${kind}:${line}:${from.id}:${to.id}`)}`,
      kind,
      from: from.id,
      to: to.id,
      label,
      line,
      ...(trigger ? { trigger } : {}),
    });
  };

  const resolveCrossFile = (
    reference: string,
    importerPrefixes: readonly string[],
  ): SysMLElement | undefined => {
    const normalized = reference.replace(/^::/, '').toLowerCase();
    if (normalized === '') return undefined;
    // Tier 1: exact qualified name somewhere in the closure.
    const exact = mergedByQualified.get(normalized);
    if (exact !== undefined && exact.length === 1) return exact[0];
    // Tier 2: unique `<prefix>::…::<name>` under a package the importing
    // file explicitly pulls in.
    let scoped: SysMLElement | undefined;
    let scopedCount = 0;
    for (const prefix of importerPrefixes) {
      const lower = `${prefix.toLowerCase()}::`;
      for (const [key, bucket] of mergedByQualified) {
        if (!key.startsWith(lower) || !key.endsWith(`::${normalized}`)) continue;
        scopedCount += bucket.length;
        scoped = bucket[0];
      }
    }
    if (scopedCount === 1) return scoped;
    // Tier 3: unique bare/suffix name across the whole closure.
    const suffix = [...mergedByQualified.entries()].filter(
      ([key]) => key === normalized || key.endsWith(`::${normalized}`),
    );
    const total = suffix.reduce((sum, [, bucket]) => sum + bucket.length, 0);
    return total === 1 ? suffix[0]![1][0] : undefined;
  };

  for (const unit of units) {
    const parsed = parsedByPath.get(unit.path)!;
    const localElements = unit.projection.elements;
    const aliases = idAliases.get(unit.path)!;
    const toMerged = (local: SysMLElement): SysMLElement | undefined =>
      mergedById.get(aliases.get(local.id) ?? local.id);
    const localResolve = (reference: string, excludeId?: string): SysMLElement | undefined => {
      const normalized = reference.replace(/^::/, '');
      const scope =
        excludeId === undefined
          ? localElements
          : localElements.filter((element) => element.id !== excludeId);
      const exact = scope.find((element) => element.qualifiedName === normalized);
      if (exact) return toMerged(exact);
      const candidates = scope.filter(
        (element) =>
          element.name === normalized || element.qualifiedName.endsWith(`::${normalized}`),
      );
      return candidates.length === 1 ? toMerged(candidates[0]!) : undefined;
    };
    const prefixes = importedPrefixes(unit.source);
    for (const candidate of parsed.pending) {
      const from = localResolve(candidate.from) ?? resolveCrossFile(candidate.from, prefixes);
      // Same-named usage/definition pairs (`part 'x' : 'x';`): never let the
      // type resolve to the declaring usage itself.
      const to =
        localResolve(candidate.to, from?.id) ?? resolveCrossFile(candidate.to, prefixes);
      if (!from || !to) {
        if (
          candidate.kind !== 'contains' &&
          !isStdLibraryReference(candidate.from) &&
          !isStdLibraryReference(candidate.to)
        ) {
          diagnostics.push({
            code: 'SY0002',
            severity: 'warning',
            message: `cannot resolve ${candidate.kind} reference '${candidate.from}' -> '${candidate.to}'`,
            line: candidate.line,
            ...(tagged ? { path: unit.path } : {}),
          });
        }
        continue;
      }
      addRelation(candidate.kind, from, to, candidate.label, candidate.line, candidate.trigger);
    }
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push({ ...diagnostic, ...(tagged ? { path: unit.path } : {}) });
    }
  }

  // Deterministic merged revision bound to every contributing byte.
  const fingerprint = units.map((unit) => `${unit.path}\u001f${unit.source}`).join('\u001e');

  return {
    units,
    entryPath,
    origins,
    projection: {
      sourceHash: `fnv1a-${fnv1aHex(fingerprint)}`,
      elements,
      relations: relations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      diagnostics,
    },
  };
}
