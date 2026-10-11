import { describe, expect, it } from 'vitest';
import { backendLabel, declaredLibraries } from './statusSlots';

/** Minimal node stand-in: the derivation only reads `kind` and `name`. */
const node = (kind: string, name: string) => ({ kind, name }) as never;

describe('declaredLibraries', () => {
  it('lists the model\'s own use declarations in document order', () => {
    const document = {
      nodes: [node('use', 'process'), node('resource', 'Server'), node('use', 'math')],
    };
    expect(declaredLibraries(document)).toEqual(['process', 'math']);
  });

  it('reports nothing for a model that declares none', () => {
    // An empty project must not render the slot at all.
    expect(declaredLibraries({ nodes: [] })).toEqual([]);
    expect(declaredLibraries({ nodes: [node('resource', 'Server')] })).toEqual([]);
  });

  it('de-duplicates a repeated declaration', () => {
    const document = { nodes: [node('use', 'process'), node('use', 'process')] };
    expect(declaredLibraries(document)).toEqual(['process']);
  });
});

describe('backendLabel', () => {
  it('prefers the target the run is bound to', () => {
    expect(backendLabel('logicpilot.native.session', ['other.target'])).toBe(
      'logicpilot.native.session',
    );
  });

  it('names the only available target when nothing is running', () => {
    expect(backendLabel(null, ['logicpilot.process.runtime'])).toBe('logicpilot.process.runtime');
  });

  it('reports how many targets exist while the choice is still open', () => {
    // A real workspace registers one target per paradigm family (ADR-0132).
    // Reporting nothing there would blank the slot in the common case.
    expect(
      backendLabel(null, [
        'logicpilot.process.runtime',
        'logicpilot.devs.runtime',
        'logicpilot.continuous.runtime',
      ]),
    ).toBe('3 targets');
    // A bound run still names its own backend, however many are available.
    expect(backendLabel('logicpilot.agent.runtime', ['a', 'b'])).toBe('logicpilot.agent.runtime');
  });

  it('reports nothing when the workspace offers no target at all', () => {
    expect(backendLabel(null, [])).toBeNull();
  });
});
