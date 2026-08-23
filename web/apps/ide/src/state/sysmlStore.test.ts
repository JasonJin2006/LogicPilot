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
