// Regression coverage for the unified problem aggregation: model-canvas
// diagnostics and plugin-contributed problem sources land in one sorted
// list (Phase 2: contributors register through the seam, the aggregator
// never names a paradigm).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseDsl } from '@logicpilot/editor';
import { startIdePluginHost, stopIdePluginHost } from '../plugins/host';
import {
  clearProblemSources,
  collectProblems,
  countProblems,
  problemSourcesVersion,
  registerProblemSource,
  subscribeProblemSources,
  type ProblemEntry,
} from './problems';

beforeAll(() => startIdePluginHost());
afterAll(() => stopIdePluginHost());

afterEach(() => {
  clearProblemSources();
});

const emptyModel = () => {
  const parsed = parseDsl('model M {\n}\n');
  if (!parsed.ok) throw new Error('fixture failed to parse');
  return parsed.document;
};

/** Minimal fake contributed source: fixed entries, version bumped on each
 *  emit so the panel-side subscription semantics stay exercised. */
function fakeSource(
  id: string,
  entries: () => readonly ProblemEntry[],
): {
  source: Parameters<typeof registerProblemSource>[0];
  emit: () => void;
  version: () => number;
} {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    source: {
      id,
      read: entries,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emit: () => {
      version += 1;
      for (const listener of [...listeners]) listener();
    },
    version: () => version,
  };
}

describe('collectProblems', () => {
  it('surfaces canvas flow diagnostics as navigable model entries', () => {
    const parsed = parseDsl('model M {\n  use process\n  source s { arrival = rate(1) }\n}\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const problems = collectProblems({ document: parsed.document });
    const unconnected = problems.filter(
      (entry) => entry.origin === 'model' && entry.code === 'LPV1001',
    );
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0]!.nodeId).toBe(
      parsed.document.nodes.find((node) => node.name === 's')?.id,
    );
  });

  it('merges contributed problem sources and sorts errors before warnings', () => {
    const source = fakeSource('contributed', () => [
      {
        id: 'contributed:1:SY0003',
        origin: 'contributed',
        code: 'SY0003',
        severity: 'warning',
        message: 'duplicate member',
        line: 4,
      },
      {
        id: 'contributed:dirty',
        origin: 'contributed',
        code: 'SY0001',
        severity: 'error',
        message: 'the source has parse errors',
      },
    ]);
    const dispose = registerProblemSource(source.source);
    try {
      const problems = collectProblems({ document: emptyModel() });
      expect(problems[0]).toMatchObject({
        origin: 'contributed',
        severity: 'error',
        id: 'contributed:dirty',
      });
      expect(problems.some((entry) => entry.code === 'SY0003' && entry.line === 4)).toBe(true);
      const ranks = problems.map((entry) => (entry.severity === 'error' ? 0 : 1));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    } finally {
      dispose();
    }
  });

  it('rejects duplicate problem source ids and removes sources on disposal', () => {
    const first = fakeSource('dup', () => []);
    const dispose = registerProblemSource(first.source);
    expect(() => registerProblemSource(fakeSource('dup', () => []).source)).toThrow(
      /already registered/,
    );
    dispose();
    // After disposal the id is free again.
    const second = fakeSource('dup', () => []);
    const dispose2 = registerProblemSource(second.source);
    dispose2();
  });

  it('notifies live hosts when sources register, update and deactivate', () => {
    const versions: number[] = [];
    const unsubscribe = subscribeProblemSources(() => versions.push(problemSourcesVersion()));
    const source = fakeSource('live', () => []);
    const dispose = registerProblemSource(source.source);
    source.emit();
    dispose();
    unsubscribe();
    expect(versions).toHaveLength(3);
    expect(versions[0]! < versions[1]!).toBe(true);
    expect(versions[1]! < versions[2]!).toBe(true);
  });

  it('returns an empty list for a clean workspace with no contributors', () => {
    expect(collectProblems({ document: emptyModel() })).toEqual([]);
  });

  it('counts severities from the same entries the panel lists', () => {
    const entries: ProblemEntry[] = [
      { id: 'a', origin: 'model', code: 'X1', severity: 'error', message: 'boom' },
      { id: 'b', origin: 'model', code: 'X2', severity: 'warning', message: 'hmm' },
      { id: 'c', origin: 'model', code: 'X3', severity: 'info', message: 'fyi' },
      { id: 'd', origin: 'sysml', code: 'X4', severity: 'error', message: 'boom again' },
    ];
    expect(countProblems(entries)).toEqual({ errors: 2, warnings: 1, infos: 1 });
    // An empty aggregation must not report phantom zeroes as "0 errors".
    expect(countProblems([])).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });
});
