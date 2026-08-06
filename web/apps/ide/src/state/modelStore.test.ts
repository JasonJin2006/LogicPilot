import { describe, expect, it } from 'vitest';
import { useModelStore } from './modelStore';

describe('modelStore entity attribute params', () => {
  it('sets, renames and removes source attribute params', () => {
    useModelStore.getState().addBlock({ kind: 'source', name: 'Jobs', x: 0, y: 0 });
    const id = useModelStore.getState().document.nodes[0]!.id;

    useModelStore.getState().setBlockParam(id, 'state priority: float', 3);
    expect(useModelStore.getState().document.nodes[0]!.params['state priority: float']).toBe(3);

    useModelStore.getState().renameBlockParam(id, 'state priority: float', 'state kind: int');
    expect(
      useModelStore.getState().document.nodes[0]!.params['state priority: float'],
    ).toBeUndefined();
    expect(useModelStore.getState().document.nodes[0]!.params['state kind: int']).toBe(3);

    useModelStore.getState().removeBlockParam(id, 'state kind: int');
    expect(useModelStore.getState().document.nodes[0]!.params['state kind: int']).toBeUndefined();
  });
});
