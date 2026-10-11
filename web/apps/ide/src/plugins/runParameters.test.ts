import { afterEach, describe, expect, it } from 'vitest';
import { registerLocalPluginContribution, runParameterDeclarations } from './registry';
import desContributions from './builtin/des/contributions.json';
import c4Contributions from './builtin/c4/contributions.json';

// The registry is a module singleton; every registration is disposed so these
// cases cannot leak into the rest of the suite.
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('run parameter contributions', () => {
  it('surfaces the knobs a paradigm pack declares', () => {
    disposers.push(registerLocalPluginContribution(desContributions));
    const byId = new Map(
      runParameterDeclarations().map((entry) => [entry.parameter.id, entry]),
    );

    // The metric vocabulary is the pack's, not the shell's. This is the whole
    // point of the seam: the shell holds no list of metric names any more.
    const metric = byId.get('metric');
    expect(metric?.pluginId).toBe('logicpilot.des');
    expect(metric?.parameter.owner).toBe('model');
    expect(metric?.parameter.choices?.map((choice) => choice.value)).toContain('Wq');

    // Run-level knobs are declared by the pack too, so a paradigm that has no
    // notion of arrivals simply does not offer one.
    expect(byId.get('arrivals')?.parameter.owner).toBe('run');
    expect(byId.get('warmup')?.parameter.owner).toBe('run');
  });

  it('keeps pacing out of the pack, because pacing is shell behaviour', () => {
    disposers.push(registerLocalPluginContribution(desContributions));
    const ids = runParameterDeclarations().map((entry) => entry.parameter.id);
    expect(ids).not.toContain('executionMode');
    expect(ids).not.toContain('speed');
  });

  it('contributes nothing for a pack that declares no run parameters', () => {
    disposers.push(registerLocalPluginContribution(c4Contributions));
    expect(runParameterDeclarations()).toEqual([]);
  });

  it('withdraws the declarations again when the pack unloads', () => {
    const dispose = registerLocalPluginContribution(desContributions);
    expect(runParameterDeclarations().length).toBeGreaterThan(0);
    dispose();
    expect(runParameterDeclarations()).toEqual([]);
  });
});
