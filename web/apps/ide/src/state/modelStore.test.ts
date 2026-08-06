import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelStore } from './modelStore';

function resetStore(): void {
  useModelStore.setState({
    document: useModelStore.getInitialState().document,
    selectedId: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    lastCommitAt: 0,
  });
}

describe('modelStore undo/redo', () => {
  beforeEach(() => {
    resetStore();
  });

  it('undo reverts and redo reapplies an edit', () => {
    useModelStore.getState().addBlock({ kind: 'source', name: 'A', x: 0, y: 0 });
    expect(useModelStore.getState().document.nodes).toHaveLength(1);
    useModelStore.getState().undo();
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
    useModelStore.getState().redo();
    expect(useModelStore.getState().document.nodes).toHaveLength(1);
  });

  it('coalesces rapid edits into one undo step', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      useModelStore.getState().addBlock({ kind: 'source', name: 'A', x: 0, y: 0 });
      vi.setSystemTime(1_200); // still within the 600ms coalesce window
      useModelStore.getState().addBlock({ kind: 'queue', name: 'Q', x: 100, y: 0 });
      expect(useModelStore.getState().document.nodes).toHaveLength(2);
      useModelStore.getState().undo();
      expect(useModelStore.getState().document.nodes).toHaveLength(0);
      useModelStore.getState().redo();
      expect(useModelStore.getState().document.nodes).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('separates edits farther apart than the coalesce window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      useModelStore.getState().addBlock({ kind: 'source', name: 'A', x: 0, y: 0 });
      vi.setSystemTime(2_000); // outside the window
      useModelStore.getState().addBlock({ kind: 'queue', name: 'Q', x: 100, y: 0 });
      useModelStore.getState().undo();
      expect(useModelStore.getState().document.nodes).toHaveLength(1);
      useModelStore.getState().undo();
      expect(useModelStore.getState().document.nodes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drag moves coalesce; undo restores the pre-drag position', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      useModelStore.getState().addBlock({ kind: 'source', name: 'A', x: 0, y: 0 });
      const id = useModelStore.getState().document.nodes[0]!.id;
      vi.setSystemTime(2_000); // past the window: the add is its own step
      useModelStore.getState().moveBlock(id, 10, 10);
      vi.setSystemTime(2_100);
      useModelStore.getState().moveBlock(id, 20, 20);
      vi.setSystemTime(2_200);
      useModelStore.getState().moveBlock(id, 30, 30);
      expect(useModelStore.getState().document.nodes[0]!.x).toBe(30);
      useModelStore.getState().undo();
      expect(useModelStore.getState().document.nodes[0]!.x).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset clears the document and the history', () => {
    useModelStore.getState().addBlock({ kind: 'source', name: 'A', x: 0, y: 0 });
    useModelStore.getState().reset();
    const state = useModelStore.getState();
    expect(state.document.nodes).toHaveLength(0);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
  });

  it('loadDocument sanitizes a malformed document instead of crashing', () => {
    const store = useModelStore.getState();
    store.loadDocument({ name: 'Broken' } as never);
    const document = useModelStore.getState().document;
    expect(Array.isArray(document.nodes)).toBe(true);
    expect(Array.isArray(document.edges)).toBe(true);
  });

  it('wiring a conditional port auto-enables its gating option', () => {
    const store = useModelStore.getState();
    store.addBlock({ kind: 'queue', name: 'Q', x: 0, y: 0 });
    store.addBlock({ kind: 'service', name: 'R', x: 120, y: 0 });
    const queue = useModelStore.getState().document.nodes.find((node) => node.name === 'Q')!;
    const service = useModelStore.getState().document.nodes.find((node) => node.name === 'R')!;
    expect(queue.params['enableTimeout']).toBeUndefined();

    // Q.outTimeout -> R.in must turn on Q's enableTimeout so the generated
    // DSL compiles (no LP5003 for the conditional port).
    store.connectBlocks(queue.id, service.id, 'outTimeout', 'in');
    const after = useModelStore.getState().document;
    const wired = after.nodes.find((node) => node.id === queue.id)!;
    expect(wired.params['enableTimeout']).toBe(true);
    expect(
      after.edges.some((edge) => edge.from === queue.id && edge.fromPort === 'outTimeout'),
    ).toBe(true);
  });
});
