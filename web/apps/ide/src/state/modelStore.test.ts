import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelStore } from './modelStore';
import { createGraphicNode, type GraphicNode } from '@logicpilot/editor';

function shape(kind: string, x: number, y: number, width = 120, height = 80): GraphicNode {
  const node = createGraphicNode(kind, x, y);
  return { ...node, transform: { ...node.transform, width, height } };
}

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

  it('setPresentation updates the object, syncs x/y and is undoable', () => {
    const store = useModelStore.getState();
    store.addBlock({
      kind: 'rect',
      name: 'rect',
      x: 10,
      y: 10,
      library: 'presentation',
      presentation: shape('rect', 10, 10),
    });
    const node = useModelStore.getState().document.nodes[0]!;
    useModelStore.setState({ lastCommitAt: 0 }); // separate undo steps
    store.setPresentation(node.id, {
      ...node.presentation!,
      transform: { ...node.presentation!.transform, width: 200, rotation: 45 },
    });
    const after = useModelStore.getState().document.nodes[0]!;
    expect(after.presentation!.transform.width).toBe(200);
    expect(after.presentation!.transform.rotation).toBe(45);
    expect(after.x).toBe(10);
    expect(after.y).toBe(10);

    store.undo();
    expect(useModelStore.getState().document.nodes[0]!.presentation!.transform.width).toBe(120);
    store.redo();
    expect(useModelStore.getState().document.nodes[0]!.presentation!.transform.width).toBe(200);
  });

  it('moveBlock keeps the presentation transform in sync', () => {
    const store = useModelStore.getState();
    store.addBlock({
      kind: 'oval',
      name: 'oval',
      x: 0,
      y: 0,
      library: 'presentation',
      presentation: shape('oval', 0, 0),
    });
    const node = useModelStore.getState().document.nodes[0]!;
    store.moveBlock(node.id, 55, 66);
    const after = useModelStore.getState().document.nodes[0]!;
    expect(after.x).toBe(55);
    expect(after.presentation!.transform.x).toBe(55);
    expect(after.presentation!.transform.y).toBe(66);
  });

  it('groups and ungroups presentation shapes', () => {
    const store = useModelStore.getState();
    store.addBlock({
      kind: 'rect',
      name: 'rect',
      x: 0,
      y: 0,
      library: 'presentation',
      presentation: shape('rect', 0, 0),
    });
    store.addBlock({
      kind: 'oval',
      name: 'oval',
      x: 200,
      y: 100,
      library: 'presentation',
      presentation: shape('oval', 200, 100),
    });
    const ids = useModelStore.getState().document.nodes.map((node) => node.id);
    const groupId = useModelStore.getState().groupShapes(ids);
    expect(groupId).not.toBeNull();
    const grouped = useModelStore.getState().document;
    expect(grouped.nodes).toHaveLength(1);
    expect(grouped.nodes[0]!.presentation?.type).toBe('group');
    expect(grouped.nodes[0]!.presentation?.children).toHaveLength(2);
    expect(grouped.nodes[0]!.x).toBe(0);
    expect(grouped.nodes[0]!.presentation?.transform.width).toBe(320);
    expect(grouped.nodes[0]!.presentation?.transform.height).toBe(180);
    expect(useModelStore.getState().selectedId).toBe(groupId);

    useModelStore.getState().ungroupShape(groupId!);
    const ungrouped = useModelStore.getState().document;
    expect(ungrouped.nodes).toHaveLength(2);
    expect(
      ungrouped.nodes.some(
        (node) =>
          node.presentation?.type === 'shape' &&
          node.presentation.geometry?.shapeType === 'rectangle',
      ),
    ).toBe(true);
    expect(ungrouped.nodes.some((node) => node.kind === 'oval')).toBe(true);
    expect(
      ungrouped.nodes.some(
        (node) => node.x === 200 && node.presentation?.geometry?.shapeType === 'ellipse',
      ),
    ).toBe(true);
  });

  it('aligns and reorders presentation shapes', () => {
    const store = useModelStore.getState();
    store.addBlock({
      kind: 'rect',
      name: 'rect',
      x: 0,
      y: 0,
      library: 'presentation',
      presentation: shape('rect', 0, 0, 100, 50),
    });
    store.addBlock({
      kind: 'rect',
      name: 'rect',
      x: 300,
      y: 200,
      library: 'presentation',
      presentation: shape('rect', 300, 200, 100, 50),
    });
    const ids = useModelStore.getState().document.nodes.map((node) => node.id);

    useModelStore.getState().alignShapes(ids, 'left');
    let nodes = useModelStore.getState().document.nodes;
    expect(nodes.every((node) => node.x === 0)).toBe(true);

    useModelStore.getState().alignShapes(ids, 'centerY');
    nodes = useModelStore.getState().document.nodes;
    expect(nodes.every((node) => node.y === 100)).toBe(true);

    useModelStore.getState().sendToBack(ids[0]!);
    nodes = useModelStore.getState().document.nodes;
    expect(nodes[0]!.id).toBe(ids[0]);
    useModelStore.getState().bringToFront(ids[0]!);
    nodes = useModelStore.getState().document.nodes;
    expect(nodes[nodes.length - 1]!.id).toBe(ids[0]);
  });

  it('distributes shapes evenly along the union span', () => {
    const store = useModelStore.getState();
    for (const x of [0, 300, 400]) {
      store.addBlock({
        kind: 'rect',
        name: 'rect',
        x,
        y: 0,
        library: 'presentation',
        presentation: shape('rect', x, 0),
      });
    }
    const ids = useModelStore.getState().document.nodes.map((node) => node.id);

    useModelStore.getState().distributeShapes(ids, 'horizontal');
    const xs = useModelStore
      .getState()
      .document.nodes.map((node) => node.presentation!.transform.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([0, 200, 400]);
  });
});
