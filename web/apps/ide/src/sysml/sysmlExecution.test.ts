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
    expect(SYSML_EXECUTION_CONFORMANCE_VERSION).toBe('0.2.0');
    const levels = new Set(['supported', 'planned', 'unsupported']);
    for (const row of SYSML_CONFORMANCE_MATRIX) {
      expect(levels.has(row.level)).toBe(true);
      expect(row.construct.length).toBeGreaterThan(0);
    }
    // The planned/unsupported rows exist so silence cannot imply support.
    expect(SYSML_CONFORMANCE_MATRIX.some((row) => row.level !== 'supported')).toBe(true);
  });

  it('pure structure/requirement models produce NO execution targets', () => {
    const projection = projectSysML('package P {\n  part def A;\n  requirement R;\n}\n');
    expect(
      extractExecutionTargets('package P {\n  part def A;\n  requirement R;\n}\n', projection),
    ).toEqual([]);
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

describe('sysmlExecution (subset 0.2 state machines + time triggers)', () => {
  function machineTarget(source: string) {
    const projection = projectSysML(source);
    const [target] = extractExecutionTargets(source, projection);
    return { projection, target: target! };
  }

  it('matrix promotes transitions and numeric triggers to supported', () => {
    const byConstruct = new Map(SYSML_CONFORMANCE_MATRIX.map((row) => [row.construct, row]));
    expect(
      byConstruct.get('flat state machines (nested states + transition succession)')?.level,
    ).toBe('supported');
    expect(
      byConstruct.get('relative/absolute time triggers (after/at numeric literals)')?.level,
    ).toBe('supported');
    expect(byConstruct.get('guard conditions (when/otherwise)')?.level).toBe('planned');
  });

  it('steps a cyclic machine deterministically from the first declared state until the budget', () => {
    // Timed hops keep the clock advancing, exercising the step-budget stop;
    // the purely synchronous cycle case is covered by the Zeno test below.
    const TRAFFIC = `state def Light {\n  state red;\n  state green;\n  state yellow;\n  transition red then green after 30 s;\n  transition green then yellow after 5 s;\n  transition yellow then red after 5 s;\n}\n`;
    const { projection, target } = machineTarget(TRAFFIC);
    expect(target.supported).toBe(true);
    const run = runExecutionTarget(TRAFFIC, projection, target.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    // Initial state is the first declaration; every entry carries t=0+.
    expect(run.steps[0]).toMatchObject({ description: 'enter red', time: 0 });
    const moves = run.steps.slice(1).map((step) => step.description.split(' ')[0]);
    // red → green → yellow → red → … repeating in declaration order.
    expect(moves.slice(0, 6)).toEqual(['red', 'green', 'yellow', 'red', 'green', 'yellow']);
    const last = run.steps[run.steps.length - 1]!;
    expect(last.description).toContain('step budget');
    // 200 hops = 66 full 40s cycles (red→30→+5→+5) plus red→green (30) and
    // green→yellow (5): 66*40 + 35.
    expect(last.time).toBe(2675);
    expect(run.result).toBeNull();
  });

  it('fires `after` triggers relative to entering the source state', () => {
    const source = `state def Cycle {\n  state off;\n  state on;\n  transition off then on after 5 s;\n  transition on then off after 2;\n}\n`;
    const { projection, target } = machineTarget(source);
    expect(target.supported).toBe(true);
    const run = runExecutionTarget(source, projection, target.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    const moves = run.steps.slice(1);
    expect(moves[0]!.description).toBe('off → on (after 5 s)');
    expect(moves[0]!.time).toBe(5);
    expect(moves[1]!.description).toBe('on → off (after 2)');
    expect(moves[1]!.time).toBe(7); // entered on at t=5
  });

  it('fires `at` absolute triggers at max(now, T) and stops cleanly on terminal states', () => {
    const source = `state def Watch {\n  state idle;\n  state done;\n  transition idle then done at 30 min;\n}\n`;
    const { projection, target } = machineTarget(source);
    expect(target.supported).toBe(true);
    const run = runExecutionTarget(source, projection, target.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    expect(run.steps).toHaveLength(2); // enter idle, idle → done; no budget note
    expect(run.steps[1]).toMatchObject({ description: 'idle → done (at 30 min)', time: 30 });
    const last = run.steps[run.steps.length - 1]!;
    expect(last.description).not.toContain('budget'); // clean completion
  });

  it('evaluates machine-level attributes before stepping and exposes them to the trace', () => {
    const source = `state def Timed {\n  attribute period = 3 * 4;\n  state a;\n  state b;\n  transition a then b after 12;\n}\n`;
    const { projection, target } = machineTarget(source);
    expect(target.supported).toBe(true);
    const run = runExecutionTarget(source, projection, target.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    expect(run.steps[0]).toMatchObject({ description: 'period := 3 * 4', value: 12 });
  });

  it('stops a zero-time cycle with an explicit Zeno note instead of looping silently', () => {
    const source = `state def PingPong {\n  state a;\n  state b;\n  transition a then b;\n  transition b then a;\n}\n`;
    const { projection, target } = machineTarget(source);
    const run = runExecutionTarget(source, projection, target.id);
    expect(run.ok).toBe(true);
    if (!run.ok || !run.steps) return;
    const last = run.steps[run.steps.length - 1]!;
    expect(last.description).toContain('Zeno');
    expect(last.time).toBe(0);
  });

  it('declines unsupported machine structures with concrete reasons', () => {
    // hierarchical nesting
    const nested = `state def H {\n  state outer {\n    state inner;\n  }\n  state plain;\n  transition outer then plain;\n}\n`;
    const [nestedTarget] = extractExecutionTargets(nested, projectSysML(nested));
    expect(nestedTarget!.supported).toBe(false);
    expect(nestedTarget!.reasons.some((r) => r.includes('hierarchical'))).toBe(true);

    // non-state member
    const mixed = `state def M {\n  state a;\n  action helper;\n  transition a then a;\n}\n`;
    const [mixedTarget] = extractExecutionTargets(mixed, projectSysML(mixed));
    expect(mixedTarget!.supported).toBe(false);
    expect(mixedTarget!.reasons.join('; ')).toContain("nested action 'helper'");

    // boundary-crossing transition
    const cross = `state def X {\n  state a;\n  state b;\n  transition a then b;\n}\nstate def Y {\n  state z;\n  transition z then a;\n}\n`;
    const targets = extractExecutionTargets(cross, projectSysML(cross));
    const yTarget = targets.find(
      (entry) => entry.kind === 'state' && entry.reasons.length > 0 && entry.qualifiedName === 'Y',
    );
    expect(yTarget).toBeDefined();
    expect(yTarget!.reasons.join('; ')).toContain('crosses the machine boundary');

    // empty machine
    const empty = 'state def E;\n';
    const [emptyTarget] = extractExecutionTargets(empty, projectSysML(empty));
    expect(emptyTarget!.supported).toBe(false);
    expect(emptyTarget!.reasons.join('; ')).toContain('no nested states');
  });
});
