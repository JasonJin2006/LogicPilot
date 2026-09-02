import { describe, expect, it } from 'vitest';
import {
  projectSysML,
  setSysMLSemanticFallbackEnabled,
  sysmlSemanticProviders,
} from './sysmlSemantics';

describe('SysML semantic provider registry', () => {
  it('exposes the builtin provider through the dispatch surface', () => {
    expect(sysmlSemanticProviders().map((provider) => provider.id)).toContain('logicpilot-sysml');
    expect(projectSysML('package Demo {}').elements).toBeDefined();
  });

  it('fails closed when the SysML provider is absent in zero-paradigm mode', () => {
    setSysMLSemanticFallbackEnabled(false);
    try {
      expect(sysmlSemanticProviders()).toEqual([]);
      expect(() => projectSysML('package Demo {}')).toThrow(/provider is not active/);
    } finally {
      setSysMLSemanticFallbackEnabled(true);
    }
  });
});
