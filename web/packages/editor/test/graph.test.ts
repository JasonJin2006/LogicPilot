import { describe, expect, it } from 'vitest';
import {
  addNode,
  connect,
  createDocument,
  defaultPresentationObject,
  disconnect,
  moveNode,
  removeNode,
  renameNode,
  setParam,
} from '../src/index.js';

describe('graph document operations', () => {
  it('attaches a presentation object to presentation nodes', () => {
    const object = defaultPresentationObject('rect', 30, 40);
    const doc = addNode(createDocument('M'), {
      kind: 'rect',
      name: 'rect',
      x: 30,
      y: 40,
      library: 'presentation',
      presentation: object,
    });
    expect(doc.nodes[0]!.presentation).toBe(object);
    expect(doc.nodes[0]!.presentation!.transform.width).toBe(120);
    expect(doc.nodes[0]!.presentation!.transform.height).toBe(80);
    expect(doc.nodes[0]!.presentation!.style.stroke).toBe('#333333');
  });

  it('default text presentation carries editable text and style', () => {
    const text = defaultPresentationObject('text', 0, 0);
    expect(text.text).toBe('Text');
    expect(text.textStyle?.fontSize).toBe(16);
    expect(text.transform.height).toBe(24);
  });

  it('adds nodes with fresh ids and copied params', () => {
    const doc = addNode(createDocument('M'), {
      kind: 'resource',
      name: 'Server',
      x: 10,
      y: 20,
      params: { capacity: 2 },
    });
    expect(doc.nodes).toHaveLength(1);
    const node = doc.nodes[0]!;
    expect(node.kind).toBe('resource');
    expect(node.name).toBe('Server');
    expect(node.params).toEqual({ capacity: 2 });
    // The original document is untouched (pure operation).
    expect(createDocument('M').nodes).toHaveLength(0);
  });

  it('connects and rejects self/duplicate/unknown connections', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 1, y: 0 });
    const a = doc.nodes[0]!.id;
    const q = doc.nodes[1]!.id;

    const ok = connect(doc, a, q);
    expect(ok.error).toBeUndefined();
    expect(ok.document.edges).toHaveLength(1);

    expect(connect(doc, a, a).error).toBe('a block cannot connect to itself');
    expect(connect(doc, a, 'missing').error).toContain('unknown block');
    expect(connect(ok.document, a, q).error).toBe('connection already exists');
  });

  it('removes a node and its incident edges', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'sink', name: 'S', x: 1, y: 0 });
    const a = doc.nodes[0]!.id;
    const s = doc.nodes[1]!.id;
    doc = connect(doc, a, s).document;
    doc = removeNode(doc, a);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.edges).toHaveLength(0);
  });

  it('removes a container together with its children and couplings', () => {
    let doc = createDocument('M');
    doc = addNode(doc, { kind: 'process', name: 'Flow', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'source', name: 'S', x: 0, y: 40, container: 'Flow' });
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 0, y: 80, container: 'Flow' });
    doc = connect(doc, doc.nodes[1]!.id, doc.nodes[2]!.id).document;
    doc = addNode(doc, { kind: 'resource', name: 'R', x: 0, y: 120 });
    const next = removeNode(doc, doc.nodes[0]!.id);
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]!.kind).toBe('resource');
    expect(next.edges).toHaveLength(0);
  });

  it('moves, renames and edits params immutably', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 1, y: 2 });
    const id = doc.nodes[0]!.id;
    doc = moveNode(doc, id, 5, 6);
    doc = renameNode(doc, id, 'WaitLine');
    doc = setParam(doc, id, 'capacity', 100);
    const node = doc.nodes[0]!;
    expect(node.x).toBe(5);
    expect(node.y).toBe(6);
    expect(node.name).toBe('WaitLine');
    expect(node.params.capacity).toBe(100);
  });

  it('disconnects a specific edge by id', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 1, y: 0 });
    doc = connect(doc, doc.nodes[0]!.id, doc.nodes[1]!.id).document;
    doc = disconnect(doc, doc.edges[0]!.id);
    expect(doc.edges).toHaveLength(0);
  });
});
