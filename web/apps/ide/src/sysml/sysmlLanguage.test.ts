import { describe, expect, it } from 'vitest';
import { projectSysML } from './sysmlProjection';
import {
  completionsAt,
  definitionAt,
  hoverAt,
  referencesOf,
  renameAt,
  wordAt,
} from './sysmlLanguage';

const SOURCE = `package Vehicle {
  part def Engine {
    port def Shaft;
  }
  part car : Engine;
  satisfy requirement Power by car;
}

requirement Power;
`;

function offsetOf(fragment: string, within = SOURCE): number {
  const index = within.indexOf(fragment);
  if (index === -1) throw new Error(`fragment not found: ${fragment}`);
  return index;
}

describe('sysmlLanguage services', () => {
  it('computes the word around a cursor offset', () => {
    const at = offsetOf('car :');
    expect(wordAt(SOURCE, at + 1).word).toBe('car');
  });

  it('suggests elements in traceability slots and keywords otherwise', () => {
    const projection = projectSysML(SOURCE);
    const afterBy = offsetOf('by car') + 'by '.length;
    const items = completionsAt(SOURCE, afterBy, projection);
    expect(items.every((item) => item.kind === 'element')).toBe(true);
    expect(items.map((item) => item.label)).toContain('Vehicle::car');

    // The target slot of a satisfy line is also an element reference.
    const satisfyLine = SOURCE.indexOf('satisfy requirement ') + 'satisfy requirement '.length;
    const targetItems = completionsAt(SOURCE.slice(0, satisfyLine), satisfyLine, projection);
    expect(targetItems.every((item) => item.kind === 'element')).toBe(true);
    expect(targetItems.map((item) => item.label)).toContain('Power');

    const freshLine = offsetOf('satisfy requirement Power by car;');
    const keywords = completionsAt(SOURCE, freshLine, projection);
    expect(keywords.every((item) => item.kind === 'keyword')).toBe(true);
    expect(keywords.map((item) => item.label)).toContain('part def');
  });

  it('hovers with the element whose block contains the offset', () => {
    const projection = projectSysML(SOURCE);
    // The Engine NAME sits inside Engine's block but not inside Shaft's -
    // innermost wins over the outer package.
    const engineName = offsetOf('Engine {') + 1;
    expect(hoverAt(projection, engineName)?.qualifiedName).toBe('Vehicle::Engine');
    const insideShaft = offsetOf('port def Shaft');
    expect(hoverAt(projection, insideShaft)?.qualifiedName).toBe('Vehicle::Engine::Shaft');
  });

  it('resolves references to their definition (go-to-definition)', () => {
    const projection = projectSysML(SOURCE);
    // `: Engine` usage line - the word Engine is a reference.
    const refOffset = offsetOf(': Engine;') + ': '.length;
    const target = definitionAt(SOURCE, projection, refOffset);
    expect(target?.qualifiedName).toBe('Vehicle::Engine');
    // On the declaration itself: the element is its own definition.
    const declOffset = offsetOf('requirement Power;') + 'requirement '.length;
    expect(definitionAt(SOURCE, projection, declOffset)?.name).toBe('Power');
  });

  it('lists every relation touching an element (references)', () => {
    const projection = projectSysML(SOURCE);
    const car = projection.elements.find((element) => element.name === 'car')!;
    const refs = referencesOf(projection, car.id);
    expect(refs.map((relation) => relation.kind)).toEqual(
      expect.arrayContaining(['contains', 'typed_by', 'satisfies']),
    );
  });

  it('renames through a cursor position on a reference', () => {
    const projection = projectSysML(SOURCE);
    const refOffset = offsetOf('by car') + 'by '.length + 1;
    const result = renameAt(SOURCE, projection, refOffset, 'chassis');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = projectSysML(result.source);
    expect(next.elements.some((element) => element.name === 'chassis')).toBe(true);
    // The satisfy statement still resolves under the new name.
    expect(next.relations.some((relation) => relation.kind === 'satisfies')).toBe(true);
  });
});
