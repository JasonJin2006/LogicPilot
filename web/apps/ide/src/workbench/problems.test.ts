// Regression coverage for the unified problem aggregation: model-canvas
// diagnostics and SysML projection entries land in one sorted list.

import { describe, expect, it } from 'vitest';
import { parseDsl } from '@logicpilot/editor';
// Side-effect import: registers the DES graph diagnostic provider consumed
// through the seam below (same registration the canvas mounts).
import '../model/modelValidation';
import { collectProblems, type SysmlProblemsInput } from './problems';
import type { SysMLProjectionDiagnostic } from '../sysml/sysmlProjection';

const sysml = (
  diagnostics: SysMLProjectionDiagnostic[],
  parseDirty = false,
): SysmlProblemsInput => ({ projection: { diagnostics }, parseDirty });

const emptyModel = () => {
  const parsed = parseDsl('model M {\n}\n');
  if (!parsed.ok) throw new Error('fixture failed to parse');
  return parsed.document;
};

describe('collectProblems', () => {
  it('surfaces canvas flow diagnostics as navigable model entries', () => {
    const parsed = parseDsl('model M {\n  use process\n  source s { arrival = rate(1) }\n}\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const problems = collectProblems({ document: parsed.document }, sysml([], false));
    const unconnected = problems.filter(
      (entry) => entry.origin === 'model' && entry.code === 'LPV1001',
    );
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0]!.nodeId).toBe(
      parsed.document.nodes.find((node) => node.name === 's')?.id,
    );
  });

  it('flags a dirty SysML parse and sorts errors before warnings', () => {
    const problems = collectProblems(
      { document: emptyModel() },
      sysml([{ code: 'SY0003', severity: 'warning', message: 'duplicate member', line: 4 }], true),
    );
    expect(problems[0]).toMatchObject({
      origin: 'sysml',
      severity: 'error',
      id: 'sysml:parse-dirty',
    });
    expect(problems.some((entry) => entry.code === 'SY0003' && entry.line === 4)).toBe(true);
    const ranks = problems.map((entry) => (entry.severity === 'error' ? 0 : 1));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('returns an empty list for a clean workspace', () => {
    expect(collectProblems({ document: emptyModel() }, sysml([], false))).toEqual([]);
  });
});
