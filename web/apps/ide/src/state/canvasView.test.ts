import { describe, expect, it } from 'vitest';
import {
  addNode,
  createDocument,
  generateDsl,
  parseDsl,
  removeNode,
  renameNode,
  type ModelDocument,
} from '@logicpilot/editor';
import { documentForView, syncCanvasViewsWithDocument, useCanvasView } from './canvasView';

/** Build the fixture document: an agent container with two stages inside. */
function agentDocument(): ModelDocument {
  let document = createDocument('M');
  document = addNode(document, { kind: 'agent', name: 'Worker', x: 0, y: 0, params: {} });
  const workerId = document.nodes[0]!.id;
  // Children carry containerId like every IDE creation path does now.
  document = addNode(document, {
    kind: 'source',
    name: 'S',
    x: 0,
    y: 0,
    params: {},
    container: 'Worker',
    containerId: workerId,
  });
  document = addNode(document, {
    kind: 'queue',
    name: 'Q',
    x: 0,
    y: 0,
    params: {},
    container: 'Worker',
    containerId: workerId,
  });
  return document;
}

const WORKER = { kind: 'agent', name: 'Worker' };
const OTHER = { kind: 'agent', name: 'Other' };

describe('canvas view', () => {
  it('null view shows only model-level elements (stages are hidden)', () => {
    const document = createDocument('M');
    expect(documentForView(document, null)).toEqual({ name: 'M', nodes: [], edges: [] });
  });

  it('root view shows flat flow members and hides agent internals', () => {
    let document = createDocument('M');
    document = addNode(document, {
      kind: 'resource',
      name: 'Server',
      x: 40,
      y: 60,
      params: { capacity: 1 },
    });
    document = addNode(document, {
      kind: 'source',
      name: 'S',
      x: 100,
      y: 200,
      params: {},
    });
    document = addNode(document, {
      kind: 'agent',
      name: 'Worker',
      x: 120,
      y: 60,
      params: { count: 1 },
    });
    // The agent's internal stage is hidden from the root canvas.
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 300,
      y: 200,
      params: {},
      container: 'Worker',
    });
    const root = documentForView(document, null);
    expect(root.nodes).toHaveLength(3);
    expect(root.nodes.every((node) => node.container === undefined)).toBe(true);
    expect(root.nodes.map((node) => node.kind)).toEqual(['resource', 'source', 'agent']);
    expect(root.edges).toHaveLength(0);
  });

  it('an agent container view filters to its nodes and inner couplings', () => {
    let document = createDocument('M');
    document = addNode(document, {
      kind: 'agent',
      name: 'Worker',
      x: 120,
      y: 60,
      params: { count: 1 },
    });
    document = addNode(document, {
      kind: 'source',
      name: 'S',
      x: 100,
      y: 200,
      params: {},
      container: 'Worker',
    });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 300,
      y: 200,
      params: {},
      container: 'Worker',
    });
    document = {
      ...document,
      edges: [{ id: 'e1', from: document.nodes[1]!.id, to: document.nodes[2]!.id }],
    };
    const worker = documentForView(document, { kind: 'agent', name: 'Worker' });
    expect(worker.nodes).toHaveLength(2);
    expect(worker.nodes.every((node) => node.container === 'Worker')).toBe(true);
    expect(worker.nodes.some((node) => node.kind === 'agent')).toBe(false);
    expect(worker.edges).toHaveLength(1);
    const other = documentForView(document, { kind: 'agent', name: 'Other' });
    expect(other.nodes).toHaveLength(0);
    expect(other.edges).toHaveLength(0);
  });

  it('agent container survives the DSL round trip', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  agent Worker {
    count = 1
    source S {
      arrival = rate(0.8)
    }
    queue Q {
      capacity = 10
    }
    couple S.out -> Q.in
  }
}
`;
    const parsed = parseDsl(source);
    expect(parsed.ok).toBe(true);
    const members = parsed.document.nodes.filter((node) => node.container === 'Worker');
    expect(members).toHaveLength(2);
    expect(members.find((node) => node.name === 'S')?.container).toBe('Worker');
    expect(members.find((node) => node.name === 'Q')?.container).toBe('Worker');

    const regenerated = generateDsl(parsed.document);
    expect(regenerated).toContain('agent Worker {');
    expect(regenerated).toContain('couple S.out -> Q.in');
    const reparsed = parseDsl(regenerated);
    expect(reparsed.ok).toBe(true);
    const reparsedMembers = reparsed.document.nodes.filter((node) => node.container === 'Worker');
    expect(reparsedMembers).toHaveLength(2);
    expect(reparsedMembers.find((node) => node.name === 'S')?.container).toBe('Worker');
    expect(reparsedMembers.find((node) => node.name === 'Q')?.container).toBe('Worker');
  });
});

describe('canvas view store (parallel tabs)', () => {
  it('opens container views in order and dedupes', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(OTHER);
    useCanvasView.getState().setView(WORKER); // already open: re-activate only
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Worker', 'Other']);
    expect(useCanvasView.getState().view).toEqual(WORKER);
  });

  it('closing the active view falls back to the last open view', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(OTHER);
    useCanvasView.getState().closeView(OTHER);
    expect(useCanvasView.getState().view).toEqual(WORKER);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Worker']);
  });

  it('closing an inactive view keeps the active one', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(OTHER);
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().closeView(OTHER);
    expect(useCanvasView.getState().view).toEqual(WORKER);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Worker']);
  });

  it('returning to the root keeps the tabs open', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(null);
    expect(useCanvasView.getState().view).toBeNull();
    expect(useCanvasView.getState().rootOpen).toBe(true);
    expect(useCanvasView.getState().views).toHaveLength(1);
  });

  it('resetCanvasViews closes every tab', () => {
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(OTHER);
    useCanvasView.getState().resetCanvasViews();
    expect(useCanvasView.getState().views).toHaveLength(0);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toBeNull();
  });

  it('closing the root falls back to the last open container', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().setView(OTHER);
    useCanvasView.getState().setView(null); // root in front
    useCanvasView.getState().closeView(null);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toEqual(OTHER);
  });

  it('closing the only canvas view empties the center', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(WORKER);
    useCanvasView.getState().closeView(WORKER);
    expect(useCanvasView.getState().views).toHaveLength(0);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toBeNull();
  });
});

describe('syncCanvasViewsWithDocument (id re-keying)', () => {
  it('a container rename keeps its open tab via containerId and refreshes the label', () => {
    const previous = agentDocument();
    const workerId = previous.nodes[0]!.id;
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView({ kind: 'agent', name: 'Worker' });
    syncCanvasViewsWithDocument(renameNode(previous, workerId, 'Falcon'), previous);
    expect(useCanvasView.getState().views).toEqual([
      { kind: 'agent', name: 'Falcon', containerId: workerId },
    ]);
    expect(useCanvasView.getState().view).toEqual({
      kind: 'agent',
      name: 'Falcon',
      containerId: workerId,
    });
  });

  it('undoing the rename carries the tab back to the old name', () => {
    const previous = agentDocument();
    const workerId = previous.nodes[0]!.id;
    const renamed = renameNode(previous, workerId, 'Falcon');
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView({ kind: 'agent', name: 'Worker' });
    syncCanvasViewsWithDocument(renamed, previous);
    syncCanvasViewsWithDocument(previous, renamed); // undo
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Worker']);
    expect(useCanvasView.getState().view).toEqual({
      kind: 'agent',
      name: 'Worker',
      containerId: workerId,
    });
  });

  it('removing the container closes its tab and falls back', () => {
    let document = agentDocument();
    document = addNode(document, { kind: 'agent', name: 'Other', x: 0, y: 0, params: {} });
    const workerId = document.nodes[0]!.id;
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView({ kind: 'agent', name: 'Worker' });
    useCanvasView.getState().setView({ kind: 'agent', name: 'Other' });
    const after = removeNode(document, workerId);
    syncCanvasViewsWithDocument(after, document);
    const otherId = after.nodes.find((node) => node.name === 'Other')!.id;
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Other']);
    expect(useCanvasView.getState().view).toEqual({
      kind: 'agent',
      name: 'Other',
      containerId: otherId,
    });
  });

  it('renaming onto an already-open name collapses into one tab', () => {
    const previous = agentDocument();
    const workerId = previous.nodes[0]!.id;
    const withGuard = addNode(previous, {
      kind: 'agent',
      name: 'Guard',
      x: 0,
      y: 0,
      params: {},
    });
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView({ kind: 'agent', name: 'Worker' });
    useCanvasView.getState().setView({ kind: 'agent', name: 'Guard' });
    syncCanvasViewsWithDocument(renameNode(withGuard, workerId, 'Guard'), withGuard);
    const names = useCanvasView.getState().views.map((view) => view.name);
    expect(names).toEqual(['Guard']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('adopts containerId for a legacy view whose container is unchanged', () => {
    const document = agentDocument();
    const workerId = document.nodes[0]!.id;
    const source = document.nodes.find((node) => node.name === 'S')!;
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView({ kind: 'agent', name: 'Worker' });
    syncCanvasViewsWithDocument(renameNode(document, source.id, 'Arrivals'));
    expect(useCanvasView.getState().views).toEqual([
      { kind: 'agent', name: 'Worker', containerId: workerId },
    ]);
  });
});
