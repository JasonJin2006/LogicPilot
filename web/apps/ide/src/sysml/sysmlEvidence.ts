// Execution evidence for the SysML semantic interpreter
// (workbench-architecture-plan.md §8 S2: "输出结构化 execution trace、
// diagnostics、result 和 evidence,并绑定模型 revision").
//
// Every Run appends one immutable record bound to the EXACT source revision
// it executed against. Records follow the layout-sidecar persistence model:
// localStorage keeps them alive for external .sysml files, and a project
// bundle carries them as presentation/sysml/<path-hash>.evidence.json so
// they travel with the project. The log is capped per document - evidence
// is a bounded recent-runs journal, not an unbounded database.

import { fnv1aHex } from './sysmlParser';
import type { TraceStep } from './sysmlExecution';
import type { SysMLVisualKind } from './sysmlProjection';

export const SYSML_EVIDENCE_FORMAT_VERSION = 1;
/** Bounded journal: the newest N runs are kept per document. */
export const SYSML_EVIDENCE_CAP = 20;

export interface SysMLEvidenceRecord {
  id: string;
  /** Document-relative target identity (stable element id). */
  targetId: string;
  targetQualifiedName: string;
  targetKind: SysMLVisualKind;
  /** Model revision the run executed against (projection sourceHash). */
  revision: string;
  ok: boolean;
  /** Wall-clock start of the run (ISO 8601); ordering aid only. */
  startedAt: string;
  durationMs: number;
  steps?: TraceStep[];
  result?: number | null;
  error?: string;
  /** Interpreter subset that produced the record. */
  conformanceVersion: string;
}

export interface SysMLEvidenceFile {
  version: number;
  records: SysMLEvidenceRecord[];
}

/** Portable project-side evidence artifact. Evidence is a run HISTORY, not
 *  a presentation concern, so it lives under presentation/history/ (the
 *  legacy presentation/sysml/ location is still read for older projects). */
export function sysmlEvidencePath(sourcePath: string): string {
  return `presentation/history/sysml/${fnv1aHex(sourcePath)}.evidence.json`;
}

/** Pre-relocation location: projects saved before the move keep their
 *  journals there, and the loader falls back to it when the new path is
 *  absent. */
export function legacySysmlEvidencePath(sourcePath: string): string {
  return `presentation/sysml/${fnv1aHex(sourcePath)}.evidence.json`;
}

export function makeEvidenceId(revision: string, targetId: string, startedAt: string): string {
  return `ev-${fnv1aHex(`${revision}|${targetId}|${startedAt}`)}`;
}

/** Append one record, cap the journal, never mutate the input array. */
export function appendEvidence(
  records: readonly SysMLEvidenceRecord[],
  record: SysMLEvidenceRecord,
): SysMLEvidenceRecord[] {
  return [record, ...records].slice(0, SYSML_EVIDENCE_CAP);
}

export function serializeEvidence(records: readonly SysMLEvidenceRecord[]): string {
  const file: SysMLEvidenceFile = {
    version: SYSML_EVIDENCE_FORMAT_VERSION,
    records: [...records],
  };
  return JSON.stringify(file, null, 2);
}

/** Defensive parse: anything malformed yields an empty journal instead of
 *  poisoning the UI (the source of truth remains the executed model). */
export function parseEvidence(serialized: string | undefined | null): SysMLEvidenceRecord[] {
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized) as Partial<SysMLEvidenceFile>;
    if (parsed.version !== SYSML_EVIDENCE_FORMAT_VERSION || !Array.isArray(parsed.records)) {
      return [];
    }
    return parsed.records.filter(
      (record): record is SysMLEvidenceRecord =>
        typeof record?.id === 'string' &&
        typeof record?.targetId === 'string' &&
        typeof record?.revision === 'string',
    );
  } catch {
    return [];
  }
}
