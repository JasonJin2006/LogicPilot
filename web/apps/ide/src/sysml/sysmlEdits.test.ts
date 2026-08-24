import { describe, expect, it } from 'vitest';
import { projectSysML } from './sysmlProjection';
import { addRelationStatement, insertElement, renameElement } from './sysmlEdits';

const BASE = `package Vehicle {
  part def Engine;
}

requirement Power;
`;

describe('sysmlEdits (typed source-text transactions)', () => {
  it('inserts a nested definition with matching indentation', () => {
    const projection = projectSysML(BASE);
    const result = insertElement(projection ? BASE : '', projection, {
      kind: 'part',
      name: 'Pump',
      declaration: 'def',
      parent: 'Vehicle',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    const pump = next.elements.find((element) => element.name === 'Pump')!;
    expect(pump.qualifiedName).toBe('Vehicle::Pump');
    expect(pump.declaration).toBe('definition');
    // The new member stays inside the package block.
    expect(result.source).toMatch(/\n {2}part def Pump;\n/);
    // And nothing else broke.
    expect(next.elements.map((element) => element.name)).toEqual(
      expect.arrayContaining(['Vehicle', 'Engine', 'Power', 'Pump']),
    );
  });

  it('expands a single-line parent body when nesting into `{ }`', () => {
    const source = 'package P {}\n';
    const result = insertElement(source, projectSysML(source), {
      kind: 'part',
      name: 'A',
      declaration: 'def',
      parent: 'P',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    expect(next.elements.map((element) => element.qualifiedName)).toContain('P::A');
    expect(result.source).toContain('part def A;');
  });

  it('appends at the model root and reports the stable element id', () => {
    const projection = projectSysML(BASE);
    const result = insertElement(BASE, projection, {
      kind: 'action',
      name: 'Run',
      declaration: 'def',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    const run = next.elements.find((element) => element.name === 'Run')!;
    expect(run.qualifiedName).toBe('Run');
    expect(run.kind).toBe('action');
    expect(result.elementId).toBe(run.id);
  });

  it('rejects duplicates, bad identifiers, unknown parents and body-less parents', () => {
    const projection = projectSysML(BASE);
    expect(
      insertElement(BASE, projection, { kind: 'part', name: 'Engine', parent: 'Vehicle' }).ok,
    ).toBe(false);
    expect(insertElement(BASE, projection, { kind: 'part', name: '9bad' }).ok).toBe(false);
    expect(insertElement(BASE, projection, { kind: 'dragon', name: 'X' }).ok).toBe(false);
    expect(insertElement(BASE, projection, { kind: 'part', name: 'X', parent: 'Missing' }).ok).toBe(
      false,
    );
    // `requirement Power;` has no block body.
    expect(insertElement(BASE, projection, { kind: 'part', name: 'X', parent: 'Power' }).ok).toBe(
      false,
    );
  });

  it('renames exactly the identifier token; children keep resolving', () => {
    const source = `package Vehicle {\n  part def Engine {\n    port def Shaft;\n  }\n}\n`;
    const projection = projectSysML(source);
    const engine = projection.elements.find((element) => element.name === 'Engine')!;
    const shaftBefore = projection.elements.find((element) => element.name === 'Shaft')!;
    const result = renameElement(source, projection, 'Engine', 'Motor');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    const motor = next.elements.find((element) => element.name === 'Motor')!;
    expect(motor.id).not.toBe(engine.id); // identity follows the qualified name
    const shaftAfter = next.elements.find((element) => element.name === 'Shaft')!;
    expect(shaftAfter.ownerId).not.toBe(shaftBefore.ownerId);
    // ...but the containment relation still holds under the new parent.
    expect(shaftAfter.ownerId).toBe(motor.id);
    expect(result.source).not.toContain('Engine');
  });

  it('refuses renames onto same-scope siblings but allows other scopes', () => {
    const source = `package P {\n  part def A;\n  part def B;\n}\npart def A2;\n`;
    void source;
    const scoped = `package P {\n  part def A;\n  part def B;\n}\n`;
    const projection = projectSysML(scoped);
    expect(renameElement(scoped, projection, 'A', 'B').ok).toBe(false);
    expect(renameElement(scoped, projection, 'A', 'C').ok).toBe(true);
  });

  it('appends typed relation statements at top level only', () => {
    const result = addRelationStatement(BASE, 'satisfy', 'Vehicle', 'Power');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    expect(next.relations.some((relation) => relation.kind === 'satisfies')).toBe(true);

    const unbalanced = addRelationStatement('package P {\n  part A;\n', 'trace', 'A', 'B');
    expect(unbalanced.ok).toBe(false);
    expect(unbalanced.ok || (unbalanced as { error: string }).error).toContain('unbalanced');
  });
});

describe('sysmlEdits scope safety', () => {
  it('rename keeps qualified references that resolve to another scope untouched', () => {
    const source = [
      'part def Pump;',
      'part def Plant {',
      '  part def Pump;',
      '}',
      'trace Plant::Pump to Plant;',
      '',
    ].join('\n');
    const projection = projectSysML(source);
    const result = renameElement(source, projection, 'Pump', 'Pump2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toContain('part def Pump2;');
    expect(result.source).toContain('trace Plant::Pump to Plant;');
    expect(result.source).not.toContain('Plant::Pump2');
    // The nested twin keeps its declaration verbatim.
    expect(result.source).toContain('part def Plant {\n  part def Pump;\n}');
  });

  it('insert rejects same-scope duplicates but allows names used elsewhere', () => {
    const source = 'part def Wheel;\npart def Plant {\n}\n';
    const projection = projectSysML(source);
    const nested = insertElement(source, projection, {
      kind: 'part',
      name: 'Wheel',
      parent: 'Plant',
    });
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(
      projectSysML(nested.source).elements.some((e) => e.qualifiedName === 'Plant::Wheel'),
    ).toBe(true);
    const clash = insertElement(source, projection, { kind: 'part', name: 'Wheel' });
    expect(clash.ok).toBe(false);
  });
});
