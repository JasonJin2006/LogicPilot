import { describe, expect, it } from 'vitest';
import { buildSysMLProjectIndex, resolveInIndex } from './sysmlProjectIndex';

const MAIN = 'package Vehicle {\n  part def Engine;\n}\n';
const OTHER = 'package Docs {\n  requirement Range;\n  part Engine;\n}\n';

describe('sysmlProjectIndex (multi-file lookups)', () => {
  it('indexes every .sysml file and ignores the rest', () => {
    const index = buildSysMLProjectIndex({
      'model/vehicle.sysml': MAIN,
      'model/docs.sysml': OTHER,
      'model/main.lp': 'model X {}\n',
      'presentation/main.canvas.json': '{}',
    });
    expect(index.files.map((file) => file.path)).toEqual(['model/vehicle.sysml', 'model/docs.sysml']);
  });

  it('resolves unique names across files and exact qualified names', () => {
    const index = buildSysMLProjectIndex({
      'a.sysml': MAIN,
      'b.sysml': OTHER,
    });
    // Bare name unique project-wide (only b.sysml declares a part named Engine
    // - wait, both do; see ambiguity test below). Qualified wins always:
    const qualified = resolveInIndex(index, 'Vehicle::Engine');
    expect(qualified?.path).toBe('a.sysml');
    const range = resolveInIndex(index, 'Range');
    expect(range?.path).toBe('b.sysml');
    expect(range?.element.kind).toBe('requirement');
  });

  it('returns nothing for ambiguous bare names instead of guessing', () => {
    const index = buildSysMLProjectIndex({ 'a.sysml': MAIN, 'b.sysml': OTHER });
    // Both files declare an element NAMED Engine (different scopes).
    expect(resolveInIndex(index, 'Engine')).toBeNull();
    expect(resolveInIndex(index, 'Missing')).toBeNull();
  });

  it('aggregates per-file diagnostics with their owning path', () => {
    const index = buildSysMLProjectIndex({
      'bad.sysml': 'part def A;\nwhat even is this;\n',
    });
    expect(index.diagnostics.some((d) => d.code === 'SY0001' && d.path === 'bad.sysml')).toBe(true);
  });
});
