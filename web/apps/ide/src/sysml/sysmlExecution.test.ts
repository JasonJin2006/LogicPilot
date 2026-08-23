import { describe, expect, it } from 'vitest';
import {
  extractExecutionTargets,
  runExecutionTarget,
  SYSML_CONFORMANCE_MATRIX,
  SYSML_EXECUTION_CONFORMANCE_VERSION,
} from './sysmlExecution';
import { projectSysML } from './sysmlProjection';

describe('sysmlExecution (subset 0.1)', () => {
  it('conformance matrix is versioned and levels are valid', () => {
    expect(SYSML_EXECUTION_CONFORMANCE_VERSION).toBe('0.1.0');
    const levels = new Set(['supported', 'planned', 'unsupported']);
    for (const row of SYSML_CONFORMANCE_MATRIX) {
      expect(levels.has(row.level)).toBe(true);
      expect(row.construct.length).toBeGreaterThan(0);
    }
    // The planned/unsupported rows exist so silence cannot imply support.
    expect(SYSML_CONFORMANCE_MATRIX.some((row) => row.level !== 'supported')).toBe(true);
  });

  it('pure structure/requirement models produce NO execution targets', () => {
    const projection = projectSysML(
      'package P {\n  part def A;\n  requirement R;\n}\n',
    );
    expect(extractExecutionTargets('package P {\n  part def A;\n  requirement R;\n}\n', projection)).toEqual([]);
  });

  it('calculations evaluate arithmetic with precedence and sibling references', () => {
    const source = `calc def FuelUse {\n  attribute base = 12;\n  attribute factor = 2 + 3 * base;\n}\n`;
    const projection = projectSysML(source);
    const targets = extractExecutionTargets(source, projection);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.supported).toBe(true);
    const run = runExecutionTarget(source, projection, targets[0]!.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    // factor = 2 + 3 * 12 = 38 (precedence), last value is the result.
    expect(run.result).toBe(38);
    expect(run.steps.map((step) => step.value)).toEqual([12, 38]);
  });

  it('actions execute assignment successions in declaration order', () => {
    const source = `action def Drain {\n  attribute level = 100;\n  attribute level = level - 25;\n  attribute half = level / 2;\n}\n`;
    const projection = projectSysML(source);
    const [target] = extractExecutionTargets(source, projection);
    const run = runExecutionTarget(source, projection, target!.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    expect(run.steps.map((step) => step.value)).toEqual([100, 75, 37.5]);
    expect(run.result).toBeNull(); // actions have no result value
    expect(run.steps[1]!.line).toBe(3);
  });

  it('marks unsupported constructs up-front instead of guessing', () => {
    const source = `state def S;\nanalysis def A;\nverification def V;\naction def Timed {\n  attribute x = after 5;\n}\n`;
    void source;
    const realSource = 'state def S;\nanalysis def A;\nverification def V;\n';
    const projection = projectSysML(realSource);
    const targets = extractExecutionTargets(realSource, projection);
    expect(targets).toHaveLength(3);
    for (const target of targets) {
      expect(target.supported).toBe(false);
      expect(target.reasons.length).toBeGreaterThan(0);
    }
    const failed = runExecutionTarget(realSource, projection, targets[0]!.id);
    expect(failed.ok).toBe(false);

    // Time triggers inside an action decline the whole target.
    const timed = 'action def T {\n  attribute x = 5;\n  attribute y = at 10;\n}\n';
    const timedProjection = projectSysML(timed);
    const [timedTarget] = extractExecutionTargets(timed, timedProjection);
    expect(timedTarget!.supported).toBe(false);
    expect(timedTarget!.reasons.some((reason) => reason.includes('time trigger'))).toBe(true);
  });

  it('reports evaluation errors deterministically with their line', () => {
    const source = 'calc def Bad {\n  attribute boom = 1 / zero;\n}\n';
    const projection = projectSysML(source);
    const [target] = extractExecutionTargets(source, projection);
    const run = runExecutionTarget(source, projection, target!.id);
    expect(run.ok).toBe(false);
    expect(run.error).toContain("unknown identifier 'zero'");
    expect(run.line).toBe(2);
  });
});
