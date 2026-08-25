// Linked multi-file model tests (plan §8 S1): import closure, cross-file
// reference resolution, per-file execution authority and last-valid
// retention. The final block reads the local amphibious raw clone (a build
// artifact, absent on machines without it) as a real-model regression.

import { describe, expect, it } from 'vitest';
// @ts-expect-error - node builtins are available in the vitest runtime; the
// app tsconfig intentionally stays DOM-only.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error - see above.
import { fileURLToPath } from 'node:url';
import { buildLinkedSysMLModel, sysmlImportClosure } from './sysmlLinkedModel';
import { extractExecutionTargets } from './sysmlExecution';

const LIB = `package Lib {
  part def '通用部件' {
    attribute mass = 12;
  }
}
`;

const NESTED_LIB = `package '03 行为与状态定义' {
  package '行为定义' {
    action def '巡检作业';
  }
}
`;

const APP = `package App {
  private import Lib::*;
  private import '03 行为与状态定义'::'行为定义'::*;

  part '设备' : '通用部件';
  action '作业A' : '巡检作业';
}
`;

const LONER = `package Lonely {
  part def Unrelated;
}
`;

describe('sysmlImportClosure', () => {
  it('pulls in files whose packages are imported, transitively', () => {
    const sources = {
      'b/app.sysml': APP,
      'a/lib.sysml': LIB,
      'c/nested.sysml': NESTED_LIB,
      'd/loner.sysml': LONER,
    };
    // Returned in sorted path order regardless of discovery order.
    expect(sysmlImportClosure('b/app.sysml', sources)).toEqual([
      'a/lib.sysml',
      'b/app.sysml',
      'c/nested.sysml',
    ]);
  });

  it('keeps an import-free document single-file even among siblings', () => {
    const sources = { 'd/loner.sysml': LONER, 'a/lib.sysml': LIB };
    expect(sysmlImportClosure('d/loner.sysml', sources)).toEqual(['d/loner.sysml']);
  });

  it('follows second-hop imports (app -> bridge -> libs)', () => {
    const bridge = `package Bridge {
      private import Lib::*;
      private import '03 行为与状态定义'::'行为定义'::*;
      part def BridgePart;
    }
    `;
    const app2 = `package App2 {
      private import Bridge::*;
      part 'x' : BridgePart;
    }
    `;
    const closure = sysmlImportClosure('app2.sysml', {
      'lib.sysml': LIB,
      'nested.sysml': NESTED_LIB,
      'bridge.sysml': bridge,
      'app2.sysml': app2,
    });
    expect(closure).toEqual(['app2.sysml', 'bridge.sysml', 'lib.sysml', 'nested.sysml']);
  });
});

describe('buildLinkedSysMLModel (cross-file resolution)', () => {
  const sources = {
    'b/app.sysml': APP,
    'a/lib.sysml': LIB,
    'c/nested.sysml': NESTED_LIB,
    'd/loner.sysml': LONER,
  };

  it('resolves typed usages into their defining file without SY0002', () => {
    const model = buildLinkedSysMLModel('b/app.sysml', sources);
    expect(model.units.map((unit) => unit.path)).toHaveLength(3); // loner excluded
    const codes = model.projection.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('SY0002');
    // typed_by edges for both cross-file references exist in the merge.
    const kinds = model.projection.relations.map((relation) => relation.kind);
    expect(kinds).toContain('typed_by');
    expect(model.projection.elements.some((element) => element.name === '通用部件')).toBe(true);
  });

  it('tags merged diagnostics with the owning path', () => {
    const broken = `package Oops {
      private import Lib::*;
      part def Broken;
      connect Broken to Missing;
    }
    `;
    const model = buildLinkedSysMLModel('oops.sysml', {
      'oops.sysml': broken,
      'a/lib.sysml': LIB,
    });
    // Two files are linked via the import, so merged diagnostics carry the
    // owning path; the unresolved `connect` keeps its warning, now tagged.
    const unresolved = model.projection.diagnostics.find(
      (diagnostic) => diagnostic.code === 'SY0002',
    );
    expect(unresolved?.path).toBe('oops.sysml');
  });

  it('uses explicit imports to disambiguate duplicate names across files', () => {
    const left = `package Left {
      part def Dup;
    }
    `;
    const right = `package Right {
      part def Dup;
    }
    `;
    const user = `package User {
      private import Left::*;
      part 'u' : Dup;
    }
    `;
    // Tier 2 scopes to imported packages: Left::Dup is the only candidate
    // under the explicitly imported prefix, so this resolves cleanly.
    const model = buildLinkedSysMLModel('user.sysml', {
      'left.sysml': left,
      'right.sysml': right,
      'user.sysml': user,
    });
    const codes = model.projection.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('SY0002');
  });

  it('keeps genuinely ambiguous bare references unresolved', () => {
    const left = `package Left {
      part def Dup;
    }
    `;
    const right = `package Right {
      part def Dup;
    }
    `;
    const user = `package User {
      part 'u' : Dup;
    }
    `;
    // No import narrows the scope; two closures-wide candidates exist, so
    // the reference must stay a warning - never a guess.
    const model = buildLinkedSysMLModel('user.sysml', {
      'left.sysml': left,
      'right.sysml': right,
      'user.sysml': user,
    });
    const codes = model.projection.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('SY0002');
  });

  it('keeps execution authority per file (spans index their own text)', () => {
    const model = buildLinkedSysMLModel('b/app.sysml', sources);
    const appUnit = model.units.find((unit) => unit.path === 'b/app.sysml')!;
    const targets = extractExecutionTargets(appUnit.source, appUnit.projection);
    // Only THIS file's executable elements; the library's parts are not here.
    expect(targets.some((target) => target.qualifiedName.startsWith('App'))).toBe(true);
    expect(targets.some((target) => target.qualifiedName.startsWith('Lib'))).toBe(false);
  });

  it('retains the last valid snapshot of a newly broken file', () => {
    const first = buildLinkedSysMLModel('b/app.sysml', sources);
    const previous = new Map(first.units.map((unit) => [unit.path, unit]));
    const brokenSources = {
      ...sources,
      'a/lib.sysml': `package Lib {
  frobnicate '通用部件';
}
`,
    };
    const second = buildLinkedSysMLModel('b/app.sysml', brokenSources, previous);
    const libUnit = second.units.find((unit) => unit.path === 'a/lib.sysml')!;
    expect(libUnit.dirty).toBe(true);
    // Last valid elements survive so the shared canvas stays stable.
    expect(libUnit.projection.elements.some((element) => element.name === '通用部件')).toBe(true);
    expect(second.projection.elements.some((element) => element.name === '通用部件')).toBe(true);
  });

  it('disambiguates identical identities declared in two files', () => {
    const cloneLeft = `package Twin {
      private import Twin::*;
      part def Same;
    }
    `;
    const cloneRight = `package Twin {
      part def Same;
    }
    `;
    // Both files declare the same root package (fragmented namespace). The
    // import in left.sysml pulls right.sysml into the closure even though
    // the package name resolves locally too.
    const model = buildLinkedSysMLModel('left.sysml', {
      'left.sysml': cloneLeft,
      'right.sysml': cloneRight,
    });
    expect(model.units.length).toBe(2);
    const ids = model.projection.elements
      .filter((element) => element.name === 'Same')
      .map((element) => element.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(model.origins[ids[0]!]).toBe('left.sysml');
    expect(model.origins[ids[1]!]).toBe('right.sysml');
  });

  it('produces a deterministic merged revision across builds', () => {
    const a = buildLinkedSysMLModel('b/app.sysml', sources);
    const b = buildLinkedSysMLModel('b/app.sysml', { ...sources });
    expect(a.projection.sourceHash).toBe(b.projection.sourceHash);
  });
});

const RAW_DIR = '../../../../../build/sysml-demo/current-raw';

describe('amphibious raw clone (local build artifact)', () => {
  const dir = fileURLToPath(new URL(RAW_DIR, import.meta.url));
  const skip = !existsSync(dir);

  it.skipIf(skip)('projects the import closure with zero SY0002', () => {
    const sources: Record<string, string> = {};
    for (const name of ['00_公共定义.sysml', '01_部件目录.sysml', '04_系统架构.sysml']) {
      sources[name] = readFileSync(`${dir}/${name}`, 'utf8');
    }
    const model = buildLinkedSysMLModel('04_系统架构.sysml', sources);
    expect(model.units.length).toBe(3);
    const codes = model.projection.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain('SY0002');
    expect(codes).not.toContain('SY0001');
    // Cross-file usage: '04 系统架构' parts typed by same-named defs in the
    // closure (self-referencing usage/def pairs must resolve, not warn).
    const typedBy = model.projection.relations.filter((relation) => relation.kind === 'typed_by');
    expect(typedBy.length).toBeGreaterThan(0);
  });
});
