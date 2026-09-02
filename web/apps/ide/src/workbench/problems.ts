// Unified problem aggregation (audit follow-up): one list across every
// open document kind so "what is wrong overall" has a single answer. The
// workbench diagnostic seam stays provider-owned; this module only reads
// the authoritative stores and maps their shapes into display entries.
//
// Phase 2 (plan §5.1): the shell never names a paradigm. The model canvas
// is the shell's own document store; every other document kind contributes
// its problem source through registerProblemSource() (the SysML plugin
// registers its projection diagnostics there).

import type { ModelDocument } from '@logicpilot/editor';
import type { WorkbenchDiagnostic } from './diagnostics';
import { diagnoseDocument } from './diagnostics';

/** Structural shape the aggregation reads from any language's diagnostics
 *  (kept local so the platform layer imports no paradigm module). */
export interface ParadigmDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  line?: number;
  path?: string;
}

/** Origin label shown per problem row. Shell-owned rows use 'model';
 *  contributed rows use their own stable id (plugin-defined string). */
export type ProblemOrigin = string;

export interface ProblemEntry {
  /** Stable React key. */
  id: string;
  origin: ProblemOrigin;
  code: string;
  severity: WorkbenchDiagnostic['severity'];
  message: string;
  /** Canvas node / language element the entry can navigate to. */
  nodeId?: string;
  /** 1-based text line (text-backed origins). */
  line?: number;
  /** Owning file for linked (multi-file) projections. */
  path?: string;
}

/** One contributed problem source. `read()` re-evaluates on demand; the
 *  source's own store subscription bumps the version the Problems panel
 *  syncs against (useSyncExternalStore without naming the store). */
export interface ProblemSource {
  /** Stable id (also the row origin label). */
  readonly id: string;
  /** Reads the current entries. */
  readonly read: () => readonly ProblemEntry[];
  /** Subscribes to the underlying store (any (listener) => disposer);
   *  every emitted change must bump the source version. */
  readonly subscribe: (listener: () => void) => () => void;
}

interface ProblemSourceEntry {
  readonly source: ProblemSource;
  /** Version bumped through the source's own subscription. */
  version: number;
  /** Disposer for the source-level subscription. */
  dispose: (() => void) | null;
}

const contributedSources = new Map<string, ProblemSourceEntry>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

function notifyRegistry(): void {
  registryVersion += 1;
  for (const listener of [...registryListeners]) listener();
}

/** Register a problem source from a plugin contribution. Duplicate ids are
 *  rejected so two plugins cannot silently double-report the same origin.
 *  The returned disposer removes the source and its subscription. */
export function registerProblemSource(source: ProblemSource): () => void {
  if (contributedSources.has(source.id)) {
    throw new Error(`problem source '${source.id}' is already registered`);
  }
  const entry: ProblemSourceEntry = {
    source,
    version: 0,
    dispose: null,
  };
  entry.dispose = source.subscribe(() => {
    entry.version += 1;
    notifyRegistry();
  });
  contributedSources.set(source.id, entry);
  notifyRegistry();
  return () => {
    if (contributedSources.get(source.id) !== entry) return;
    contributedSources.delete(source.id);
    entry.dispose?.();
    notifyRegistry();
  };
}

/** Test/teardown helper: removes every contributed source. */
export function clearProblemSources(): void {
  if (contributedSources.size === 0) return;
  for (const entry of [...contributedSources.values()]) {
    contributedSources.delete(entry.source.id);
    entry.dispose?.();
  }
  notifyRegistry();
}

/** Catalog snapshot used by tests and neutral hosts. */
export function contributedProblemStores(): readonly {
  readonly source: ProblemSource;
  readonly version: () => number;
}[] {
  return [...contributedSources.values()].map((entry) => ({
    source: entry.source,
    version: () => entry.version,
  }));
}

/** One subscription covers source registration/removal and source updates,
 *  so a live Problems panel follows plugin activation and deactivation. */
export function subscribeProblemSources(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function problemSourcesVersion(): number {
  return registryVersion;
}

function modelProblems(document: ModelDocument): ProblemEntry[] {
  return diagnoseDocument('dsl', document).map((diagnostic, index) => ({
    id: `model:${diagnostic.code}:${diagnostic.nodeId ?? diagnostic.edgeId ?? index}`,
    origin: 'model' as const,
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    nodeId: diagnostic.nodeId ?? diagnostic.edgeId,
  }));
}

const SEVERITY_RANK: Record<ProblemEntry['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Current problems across the model canvas and every contributed problem
 *  source, errors first (stable within a severity). */
export function collectProblems(model: { document: ModelDocument }): ProblemEntry[] {
  const entries: ProblemEntry[] = [...modelProblems(model.document)];
  for (const entry of contributedSources.values()) {
    entries.push(...entry.source.read());
  }
  return entries.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
