import { describe, expect, it } from 'vitest';
import {
  addNode,
  connect,
  createDocument,
  disconnect,
  moveNode,
  removeNode,
  renameNode,
  setParam,
} from '../src/index.js';

describe('graph document operations', () => {
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
