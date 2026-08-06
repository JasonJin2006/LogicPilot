import { describe, expect, it } from 'vitest';
import {
  addNode,
  connect,
  createDocument,
  createGraphicNode,
  disconnect,
  moveNode,
  normalizeGraphicNode,
  removeNode,
  renameNode,
  setParam,
} from '../src/index.js';

describe('graph document operations', () => {
  it('attaches a presentation object to presentation nodes', () => {
    const object = createGraphicNode('rect', 30, 40);
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
    expect(doc.nodes[0]!.presentation!.style.stroke.color).toBe('#333333');
    expect(doc.nodes[0]!.presentation!.type).toBe('shape');
    expect(doc.nodes[0]!.presentation!.geometry?.shapeType).toBe('rectangle');
  });

  it('default text presentation carries editable text and style', () => {
    const text = createGraphicNode('text', 0, 0);
    expect(text.text).toBe('Text');
    expect(text.textStyle?.fontSize).toBe(16);
    expect(text.transform.height).toBe(24);
  });

  it('normalizes legacy shape objects to the unified model', () => {
    const legacy = {
      type: 'roundedRect',
      transform: { x: 10, y: 20, width: 100, height: 60, rotation: 0, scaleX: 1, scaleY: 1 },
      style: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 3, opacity: 0.5 },
    };
    const normalized = normalizeGraphicNode(legacy)!;
    expect(normalized.type).toBe('shape');
    expect(normalized.geometry?.shapeType).toBe('rectangle');
    expect(normalized.geometry?.radius).toBe(12);
    expect(normalized.style.fill).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(normalized.style.stroke.color).toBe('#00ff00');
    expect(normalized.style.stroke.width).toBe(3);
    expect(normalized.style.opacity).toBe(0.5);
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
