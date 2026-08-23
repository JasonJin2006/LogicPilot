import { describe, expect, it } from 'vitest';
import { parseDsl } from '@logicpilot/editor';
import { lowerStateMachine } from './sysmlLowering';
import { projectSysML } from './sysmlProjection';

const TRAFFIC = `state def Light {\n  state red;\n  state green;\n  state yellow;\n  transition red then green after 30 s;\n  transition green then yellow after 5;\n  transition yellow then red after 500 ms;\n}\n`;

function lower(source: string) {
  const projection = projectSysML(source);
  const target = projection.elements.find(
    (element) => element.kind === 'state' && element.declaration === 'definition',
  );
  return lowerStateMachine(source, projection, target!.id);
}

describe('sysmlLowering (state machine → .lp statechart DSL)', () => {
  it('lowers the traffic light to kernel DSL with unit conversion', () => {
    const result = lower(TRAFFIC);
    expect(result.ok).toBe(true);
    expect(result.modelName).toBe('Lowered_Light');
    expect(result.entryState).toBe('red');
    expect(result.diagnostics).toEqual([]);
    expect(result.dsl).toBe(
      `model Lowered_Light {\n` +
        `  statechart Light {\n` +
        `    initial = red\n` +
        `    state red { }\n` +
        `    state green { }\n` +
        `    state yellow { }\n` +
        `    transition red_green { from = red; to = green; triggeredBy = timeout; timeout = 30.0 }\n` +
        `    transition green_yellow { from = green; to = yellow; triggeredBy = timeout; timeout = 5.0 }\n` +
        `    transition yellow_red { from = yellow; to = red; triggeredBy = timeout; timeout = 0.5 }\n` +
        `  }\n` +
        `}\n`,
    );
    // The generated source must parse on the shared frontend grammar.
    expect(parseDsl(result.dsl).ok).toBe(true);
  });

  it('converts time units to seconds', () => {
    const result = lower(
      `state def M {\n  state a;\n  state b;\n  transition a then b after 250 ms;\n  transition b then a after 2 min;\n}\n`,
    );
    expect(result.ok).toBe(true);
    expect(result.dsl).toContain('timeout = 0.25');
    expect(result.dsl).toContain('timeout = 120.0');
  });

  it('refuses absolute-time triggers instead of changing semantics', () => {
    const result = lower(
      `state def M {\n  state a;\n  state b;\n  transition a then b at 10;\n}\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('SL0003');
    expect(result.diagnostics[0]!.message).toContain('relative to state entry');
  });

  it('refuses trigger-less transitions (kernel needs a trigger)', () => {
    const result = lower(`state def M {\n  state a;\n  transition a then b;\n  state b;\n}\n`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('SL0004');
  });

  it('refuses nested sub-states (flat kernel machine)', () => {
    const result = lower(
      `state def M {\n  state outer {\n    state inner;\n  }\n}\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('SL0002');
    expect(result.diagnostics[0]!.message).toContain("'outer'");
  });

  it('refuses transitions that leave the machine scope', () => {
    const result = lower(
      `state def M {\n  state a;\n  transition a then Outside;\n}\nstate def Outside;\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('SL0006');
  });

  it('rejects non-state targets', () => {
    const projection = projectSysML('package P {\n  part def A;\n}\n');
    const part = projection.elements.find((element) => element.kind === 'part')!;
    const result = lowerStateMachine('package P {\n  part def A;\n}\n', projection, part.id);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]!.code).toBe('SL0001');
  });
});
