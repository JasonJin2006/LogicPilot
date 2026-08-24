// Unified problem aggregation (audit follow-up): one list across every
// open document kind so "what is wrong overall" has a single answer. The
// workbench diagnostic seam stays provider-owned; this module only reads
// the authoritative stores and maps their shapes into display entries.

import type { ModelDocument } from '@logicpilot/editor';
import type { WorkbenchDiagnostic } from './diagnostics';
import { diagnoseDocument } from './diagnostics';
import type { SysMLProjectionDiagnostic } from '../sysml/sysmlProjection';

export type ProblemOrigin = 'model' | 'sysml';

export interface ProblemEntry {
  /** Stable React key. */
  id: string;
  origin: ProblemOrigin;
  code: string;
  severity: WorkbenchDiagnostic['severity'];
  message: string;
  /** Canvas node / SysML element the entry can navigate to. */
  nodeId?: string;
  /** 1-based text line (text-backed origins). */
  line?: number;
}

export interface SysmlProblemsInput {
  projection: { diagnostics: SysMLProjectionDiagnostic[] } | null;
  parseDirty: boolean;
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

function sysmlProblems(
  projection: SysmlProblemsInput['projection'],
  parseDirty: boolean,
): ProblemEntry[] {
  const entries: ProblemEntry[] = [];
  if (parseDirty) {
    entries.push({
      id: 'sysml:parse-dirty',
      origin: 'sysml',
      code: 'SY0001',
      severity: 'error',
      message: 'the SysML source has parse errors - the canvas shows the last valid projection',
    });
  }
  for (const [index, diagnostic] of (projection?.diagnostics ?? []).entries()) {
    entries.push({
      id: `sysml:${index}:${diagnostic.code}`,
      origin: 'sysml',
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      line: diagnostic.line,
    });
  }
  return entries;
}

const SEVERITY_RANK: Record<ProblemEntry['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Current problems across the open model canvas and SysML document,
 *  errors first (stable within a severity). */
export function collectProblems(
  model: { document: ModelDocument },
  sysml: SysmlProblemsInput,
): ProblemEntry[] {
  return [
    ...modelProblems(model.document),
    ...sysmlProblems(sysml.projection, sysml.parseDirty),
  ].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
