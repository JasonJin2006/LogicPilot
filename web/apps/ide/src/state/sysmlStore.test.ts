import { beforeEach, describe, expect, it } from 'vitest';
import { useSysMLStore } from './sysmlStore';

describe('SysML projection store', () => {
  beforeEach(() => useSysMLStore.getState().clear());

  it('keeps layout edits undoable and redoable without changing source', () => {
    const source = 'package P {\n  part def A {}\n}\n';
    useSysMLStore.getState().load('model/a.sysml', source);
    expect(useSysMLStore.getState().layoutDirty).toBe(false);
    const element = useSysMLStore.getState().projection!.elements.find((entry) => entry.name === 'A')!;
    const original = useSysMLStore.getState().layout!.positions[element.id]!;
    useSysMLStore.getState().checkpoint();
    useSysMLStore.getState().move(element.id, { x: 420, y: 260 });
    expect(useSysMLStore.getState().layoutDirty).toBe(true);
    expect(useSysMLStore.getState().source).toBe(source);
    expect(useSysMLStore.getState().layout!.positions[element.id]).toEqual({ x: 420, y: 260 });
    useSysMLStore.getState().undo();
    expect(useSysMLStore.getState().layout!.positions[element.id]).toEqual(original);
    useSysMLStore.getState().redo();
    expect(useSysMLStore.getState().layout!.positions[element.id]).toEqual({ x: 420, y: 260 });
    useSysMLStore.getState().markLayoutPersisted();
    expect(useSysMLStore.getState().layoutDirty).toBe(false);
  });

  it('changes visual focus without changing the projection', () => {
    useSysMLStore.getState().load(
      'model/a.sysml',
      'part def A {}\nrequirement def R {}\nstate def S {}\n',
    );
    const count = useSysMLStore.getState().projection!.elements.length;
    useSysMLStore.getState().setViewMode('requirements');
    expect(useSysMLStore.getState().viewMode).toBe('requirements');
    expect(useSysMLStore.getState().projection!.elements).toHaveLength(count);
  });
});

  it('keeps the last valid snapshot while the source has errors (parseDirty)', () => {
    useSysMLStore.getState().load('model/a.sysml', 'package P {\n  part def A {}\n}\n');
    const validProjection = useSysMLStore.getState().projection!;
    expect(useSysMLStore.getState().parseDirty).toBe(false);

    // Broken edit: the raw source updates, the semantic snapshot does not.
    useSysMLStore.getState().refresh('package P {\n  part def A {\n');
    const state = useSysMLStore.getState();
    expect(state.parseDirty).toBe(true);
    expect(state.projection).toBe(validProjection);
    expect(state.source).toContain('part def A {');

    // Fixed: the projection advances again.
    useSysMLStore
      .getState()
      .refresh('package P {\n  part def A {}\n  requirement R;\n}\n');
    expect(useSysMLStore.getState().parseDirty).toBe(false);
    expect(useSysMLStore.getState().projection!.elements.map((e) => e.name)).toEqual([
      'P',
      'A',
      'R',
    ]);
  });
