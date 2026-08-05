import { describe, expect, it } from 'vitest';
import { addNode, createDocument, generateDsl, parseDsl } from '@logicpilot/editor';
import { documentForView, useCanvasView } from './canvasView';

const FLOW = { kind: 'process', name: 'Flow' };
const BACKUP = { kind: 'process', name: 'Backup' };

describe('canvas view', () => {
  it('null view shows only model-level elements (stages are hidden)', () => {
    const document = createDocument('M');
    expect(documentForView(document, null)).toEqual({ name: 'M', nodes: [], edges: [] });
  });

  it('root view hides stages and shows resources and container Nodes', () => {
    let document = createDocument('M');
    document = addNode(document, {
      kind: 'resource',
      name: 'Server',
      x: 40,
      y: 60,
      params: { capacity: 1 },
    });
    document = addNode(document, { kind: 'process', name: 'Flow', x: 120, y: 60, params: {} });
    document = addNode(document, {
      kind: 'source',
      name: 'S',
      x: 100,
      y: 200,
      params: {},
      container: 'Flow',
    });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 300,
      y: 200,
      params: {},
      container: 'Flow',
    });
    const root = documentForView(document, null);
    expect(root.nodes).toHaveLength(2);
    expect(root.nodes.every((node) => node.container === undefined)).toBe(true);
    expect(root.nodes.map((node) => node.kind)).toEqual(['resource', 'process']);
    expect(root.edges).toHaveLength(0);
  });

  it('a container view filters to its nodes and inner couplings', () => {
    let document = createDocument('M');
    document = addNode(document, { kind: 'process', name: 'Flow', x: 120, y: 60, params: {} });
    document = addNode(document, {
      kind: 'source',
      name: 'S',
      x: 100,
      y: 200,
      params: {},
      container: 'Flow',
    });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 300,
      y: 200,
      params: {},
      container: 'Flow',
    });
    document = {
      ...document,
      edges: [
        { id: 'e1', from: document.nodes[1]!.id, to: document.nodes[2]!.id },
      ],
    };
    const flow = documentForView(document, { kind: 'process', name: 'Flow' });
    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes.every((node) => node.container === 'Flow')).toBe(true);
    expect(flow.nodes.some((node) => node.kind === 'process')).toBe(false);
    expect(flow.edges).toHaveLength(1);
    const other = documentForView(document, { kind: 'process', name: 'Other' });
    expect(other.nodes).toHaveLength(0);
    expect(other.edges).toHaveLength(0);
  });

  it('container survives the DSL round trip', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  process Flow {
    source S {
      arrival = rate(0.8)
    }
    queue Q {
      capacity = 10
    }
  }
  process Backup {
    sink Done { }
  }
}
`;
    const parsed = parseDsl(source);
    expect(parsed.ok).toBe(true);
    const stages = parsed.document.nodes.filter(
      (node) => node.kind !== 'resource' && node.kind !== 'process',
    );
    expect(stages.every((node) => node.container === 'Flow' || node.container === 'Backup')).toBe(
      true,
    );
    expect(stages.find((node) => node.name === 'S')?.container).toBe('Flow');
    expect(stages.find((node) => node.name === 'Done')?.container).toBe('Backup');

    const regenerated = generateDsl(parsed.document);
    expect(regenerated).toContain('process Flow');
    expect(regenerated).toContain('process Backup');
    const reparsed = parseDsl(regenerated);
    expect(reparsed.ok).toBe(true);
    const reparsedStages = reparsed.document.nodes.filter(
      (node) => node.kind !== 'resource' && node.kind !== 'process',
    );
    expect(reparsedStages.find((node) => node.name === 'S')?.container).toBe('Flow');
    expect(reparsedStages.find((node) => node.name === 'Done')?.container).toBe('Backup');
  });
});

describe('canvas view store (parallel tabs)', () => {
  it('opens container views in order and dedupes', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(BACKUP);
    useCanvasView.getState().setView(FLOW); // already open: re-activate only
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual([
      'Flow',
      'Backup',
    ]);
    expect(useCanvasView.getState().view).toEqual(FLOW);
  });

  it('closing the active view falls back to the last open view', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(BACKUP);
    useCanvasView.getState().closeView(BACKUP);
    expect(useCanvasView.getState().view).toEqual(FLOW);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Flow']);
  });

  it('closing an inactive view keeps the active one', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(BACKUP);
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().closeView(BACKUP);
    expect(useCanvasView.getState().view).toEqual(FLOW);
    expect(useCanvasView.getState().views.map((view) => view.name)).toEqual(['Flow']);
  });

  it('returning to the root keeps the tabs open', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(null);
    expect(useCanvasView.getState().view).toBeNull();
    expect(useCanvasView.getState().rootOpen).toBe(true);
    expect(useCanvasView.getState().views).toHaveLength(1);
  });

  it('resetCanvasViews closes every tab', () => {
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(BACKUP);
    useCanvasView.getState().resetCanvasViews();
    expect(useCanvasView.getState().views).toHaveLength(0);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toBeNull();
  });

  it('closing the root falls back to the last open container', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().setView(BACKUP);
    useCanvasView.getState().setView(null); // root in front
    useCanvasView.getState().closeView(null);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toEqual(BACKUP);
  });

  it('closing the only canvas view empties the center', () => {
    useCanvasView.getState().resetCanvasViews();
    useCanvasView.getState().setView(FLOW);
    useCanvasView.getState().closeView(FLOW);
    expect(useCanvasView.getState().views).toHaveLength(0);
    expect(useCanvasView.getState().rootOpen).toBe(false);
    expect(useCanvasView.getState().view).toBeNull();
  });
});
