import { describe, expect, it } from 'vitest';
import { autoLayoutSysML, projectSysML } from './sysmlProjection';

describe('SysML external projection', () => {
  it('projects structure, containment and traceability relations without executing the source', () => {
    const projection = projectSysML(`
package Vehicle {
  part def Car {
    port def Power;
    port power : Power;
  }
  requirement def Safe;
  part car : Car;
  satisfy requirement Safe by car;
}
`);

    expect(projection.elements.map((element) => element.name)).toEqual([
      'Vehicle',
      'Car',
      'Power',
      'power',
      'Safe',
      'car',
    ]);
    expect(projection.relations.some((relation) => relation.kind === 'contains')).toBe(true);
    expect(projection.relations.some((relation) => relation.kind === 'satisfies')).toBe(true);
    expect(projection.elements.every((element) => element.id.startsWith('sysml-'))).toBe(true);
  });

  it('keeps IDs stable and reports unresolved visual references as warnings', () => {
    const source = 'part def A {}\nconnect A to Missing;\n';
    const first = projectSysML(source);
    const second = projectSysML(source);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.elements.map((element) => element.id)).toEqual(second.elements.map((element) => element.id));
    // SY0002 is the stable unresolved-reference warning (parser code table).
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ code: 'SY0002', severity: 'warning' }),
    ]);
  });

  it('produces deterministic positions for the visual sidecar', () => {
    const projection = projectSysML('package P {\n  part def A {}\n  part def B {}\n}\n');
    const layout = autoLayoutSysML(projection);
    expect(Object.keys(layout.positions)).toHaveLength(3);
    expect(layout.positions[projection.elements[0]!.id]).toEqual({ x: 80, y: 80 });
    expect(layout.sourceHash).toBe(projection.sourceHash);
  });

  it('recognizes extended architecture and traceability relations', () => {
    const projection = projectSysML(`
package System {
  view def Context;
  constraint def SafeLimit;
  part def Controller;
  part def Plant;
  allocate Controller to Plant;
  derive SafeLimit from Controller;
}
`);
    expect(projection.elements.map((element) => element.kind)).toEqual([
      'package', 'view', 'constraint', 'part', 'part',
    ]);
    expect(projection.relations.map((relation) => relation.kind)).toEqual(
      expect.arrayContaining(['allocates', 'derives']),
    );
    const traceLayout = autoLayoutSysML(projection, 'traceability');
    expect(Object.keys(traceLayout.positions)).toHaveLength(projection.elements.length);
  });
});
