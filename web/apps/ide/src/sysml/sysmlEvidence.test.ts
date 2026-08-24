import { describe, expect, it } from 'vitest';
import {
  appendEvidence,
  legacySysmlEvidencePath,
  makeEvidenceId,
  parseEvidence,
  serializeEvidence,
  SYSML_EVIDENCE_CAP,
  sysmlEvidencePath,
  type SysMLEvidenceRecord,
} from './sysmlEvidence';
import { fnv1aHex } from './sysmlParser';

function record(overrides: Partial<SysMLEvidenceRecord> = {}): SysMLEvidenceRecord {
  return {
    id: 'ev-1',
    targetId: 'sysml-abc',
    targetQualifiedName: 'FuelUse',
    targetKind: 'calculation',
    revision: 'fnv1a-deadbeef',
    ok: true,
    startedAt: '2026-08-23T10:00:00.000Z',
    durationMs: 3,
    steps: [{ index: 0, description: 'base := 12', value: 12 }],
    result: 38,
    conformanceVersion: '0.2.0',
    ...overrides,
  };
}

describe('sysmlEvidence (revision-bound run journal)', () => {
  it('derives a stable portable sidecar path per document under history/', () => {
    expect(sysmlEvidencePath('models/power.sysml')).toBe(
      `presentation/history/sysml/${fnv1aHex('models/power.sysml')}.evidence.json`,
    );
  });

  it('keeps the pre-relocation path available for legacy projects', () => {
    expect(legacySysmlEvidencePath('models/power.sysml')).toBe(
      `presentation/sysml/${fnv1aHex('models/power.sysml')}.evidence.json`,
    );
  });

  it('caps the journal to the newest records without mutating the input', () => {
    const original = Array.from({ length: SYSML_EVIDENCE_CAP }, (_, i) =>
      record({ id: `ev-${i}` }),
    );
    const fresh = record({ id: 'ev-new' });
    const next = appendEvidence(original, fresh);
    expect(next).toHaveLength(SYSML_EVIDENCE_CAP);
    expect(next[0]!.id).toBe('ev-new');
    expect(next.at(-1)!.id).toBe(`ev-${SYSML_EVIDENCE_CAP - 2}`);
    expect(original).toHaveLength(SYSML_EVIDENCE_CAP);
    expect(original[0]!.id).toBe('ev-0');
  });

  it('round-trips through the versioned file format', () => {
    const serialized = serializeEvidence([record()]);
    const parsed = parseEvidence(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(record());
  });

  it('rejects malformed or foreign payloads defensively', () => {
    expect(parseEvidence(undefined)).toEqual([]);
    expect(parseEvidence(null)).toEqual([]);
    expect(parseEvidence('not json at all')).toEqual([]);
    expect(parseEvidence('{"version": 99, "records": []}')).toEqual([]);
    expect(parseEvidence('{"version": 1}')).toEqual([]);
    expect(
      parseEvidence(JSON.stringify({ version: 1, records: [{ nope: true }, record()] })),
    ).toHaveLength(1);
  });

  it('evidence ids are stable for the same run inputs', () => {
    const a = makeEvidenceId('rev-1', 'target-1', '2026-08-23T10:00:00.000Z');
    const b = makeEvidenceId('rev-1', 'target-1', '2026-08-23T10:00:00.000Z');
    const c = makeEvidenceId('rev-2', 'target-1', '2026-08-23T10:00:00.000Z');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
