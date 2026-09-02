import { describe, expect, it } from 'vitest';
import {
  modelBlockPorts,
  modelIsExecutableProcessKind,
  modelPortGlyphPoint,
  modelSemanticProviders,
  registerModelSemanticProvider,
  setModelSemanticFallbackEnabled,
} from './modelSemantics';

describe('model semantic registry', () => {
  it('exposes the builtin Process provider through a neutral seam', () => {
    expect(modelSemanticProviders().map((provider) => provider.id)).toContain('logicpilot-process');
    expect(modelBlockPorts('queue').some((port) => port.name === 'in')).toBe(true);
    expect(modelIsExecutableProcessKind('queue')).toBe(true);
    expect(modelPortGlyphPoint('queue', 'in', 'in')).toEqual([7, 20]);
  });

  it('supports lifecycle-scoped provider registration and removal', () => {
    const provider = {
      id: 'test-semantic-provider',
      blockPorts: () => [],
      isExecutableProcessKind: () => false,
      portGlyphPoint: () => [20, 20] as [number, number],
    };
    const dispose = registerModelSemanticProvider(provider);
    expect(modelSemanticProviders().some((entry) => entry.id === provider.id)).toBe(true);
    dispose();
    expect(modelSemanticProviders().some((entry) => entry.id === provider.id)).toBe(false);
  });

  it('removes the builtin fallback during a zero-paradigm lifecycle', () => {
    setModelSemanticFallbackEnabled(false);
    try {
      expect(modelSemanticProviders()).toEqual([]);
      expect(modelBlockPorts('queue')).toEqual([]);
      expect(modelIsExecutableProcessKind('queue')).toBe(false);
    } finally {
      setModelSemanticFallbackEnabled(true);
    }
  });
});
