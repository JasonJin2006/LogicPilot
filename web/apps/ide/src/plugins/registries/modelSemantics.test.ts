import { describe, expect, it } from 'vitest';
import {
  modelBlockPorts,
  modelIsCanvasContainer,
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
    expect(modelIsCanvasContainer('statechart')).toBe(true);
    expect(modelIsCanvasContainer('queue')).toBe(false);
  });

  it('supports lifecycle-scoped provider registration and removal', () => {
    const provider = {
      id: 'test-semantic-provider',
      blockPorts: () => [],
      isExecutableProcessKind: () => false,
      portGlyphPoint: () => [20, 20] as [number, number],
      isCanvasContainer: () => false,
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
      expect(modelIsCanvasContainer('statechart')).toBe(false);
    } finally {
      setModelSemanticFallbackEnabled(true);
    }
  });

  it('dispatches by declared semantic ownership instead of first registration order', () => {
    const left = {
      id: 'semantic-left',
      supports: (kind: string) => kind === 'left',
      blockPorts: () => [],
      isExecutableProcessKind: () => false,
      portGlyphPoint: () => [1, 1] as [number, number],
      isCanvasContainer: () => false,
    };
    const right = {
      id: 'semantic-right',
      supports: (kind: string) => kind === 'right',
      blockPorts: () => [],
      isExecutableProcessKind: () => false,
      portGlyphPoint: () => [2, 2] as [number, number],
      isCanvasContainer: () => false,
    };
    const disposeLeft = registerModelSemanticProvider(left);
    const disposeRight = registerModelSemanticProvider(right);
    try {
      expect(modelPortGlyphPoint('left', 'unused', 'in')).toEqual([1, 1]);
      expect(modelPortGlyphPoint('right', 'unused', 'in')).toEqual([2, 2]);
    } finally {
      disposeRight();
      disposeLeft();
    }
  });
});
