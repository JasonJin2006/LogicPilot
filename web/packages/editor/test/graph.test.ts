import { describe, expect, it } from 'vitest';
import {
  addNode,
  childrenOfContainer,
  connect,
  createDocument,
  createGraphicNode,
  disconnect,
  isRootMember,
  moveNode,
  normalizeGraphicNode,
  parentOfNode,
  parseDsl,
  removeParam,
  removeNode,
  renameNode,
  renameParam,
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

  it('keeps polylines open and supports connector arrowheads', () => {
    const object = createGraphicNode('polyline', 10, 20);
    expect(object.geometry?.shapeType).toBe('polyline');
    object.style.stroke.startArrow = 'circle';
    object.style.stroke.endArrow = 'arrow';
    expect(object.style.stroke).toMatchObject({ startArrow: 'circle', endArrow: 'arrow' });
  });

  it('normalizes text and design-time layer state from older documents', () => {
    const normalized = normalizeGraphicNode({
      ...createGraphicNode('text', 0, 0),
      textStyle: { fontFamily: 'Inter', fontSize: 18, fontWeight: 400, align: 'left' },
      visible: false,
      locked: true,
    });
    expect(normalized?.visible).toBe(false);
    expect(normalized?.locked).toBe(true);
    expect(normalized?.textStyle).toMatchObject({
      fontFamily: 'Inter',
      lineHeight: 1.2,
      verticalAlign: 'middle',
    });
  });

  it('default text presentation carries editable text and style', () => {
    const text = createGraphicNode('text', 0, 0);
    expect(text.text).toBe('Text');
    expect(text.textStyle?.fontSize).toBe(16);
    expect(text.transform.height).toBe(24);
  });

  it('creates composable polygon and star primitives', () => {
    const polygon = createGraphicNode('polygon', 10, 20);
    const star = createGraphicNode('star', 10, 20);
    expect(polygon.geometry?.shapeType).toBe('polygon');
    expect(polygon.geometry?.points).toHaveLength(6);
    expect(star.geometry?.shapeType).toBe('polygon');
    expect(star.geometry?.points).toHaveLength(10);
    const radii = star.geometry!.points!.map((point) => Math.hypot(point.x - 0.5, point.y - 0.5));
    expect(Math.min(...radii)).toBeLessThan(Math.max(...radii) * 0.6);
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

  it('removes and renames params immutably', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'S', x: 0, y: 0 });
    const id = doc.nodes[0]!.id;
    doc = setParam(doc, id, 'state priority: float', 3);
    doc = setParam(doc, id, 'arrival', 'rate(1.0)');
    doc = removeParam(doc, id, 'arrival');
    expect(doc.nodes[0]!.params['arrival']).toBeUndefined();
    expect(doc.nodes[0]!.params['state priority: float']).toBe(3);
    doc = renameParam(doc, id, 'state priority: float', 'state kind: int');
    expect(doc.nodes[0]!.params['state priority: float']).toBeUndefined();
    expect(doc.nodes[0]!.params['state kind: int']).toBe(3);
  });

  it('renaming a container keeps its children linked (name-based container)', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'process', name: 'Flow', x: 0, y: 0 });
    const flowId = doc.nodes[0]!.id;
    doc = addNode(doc, { kind: 'source', name: 'S', x: 1, y: 1, container: 'Flow' });
    doc = addNode(doc, { kind: 'sink', name: 'D', x: 2, y: 1, container: 'Flow' });
    doc = renameNode(doc, flowId, 'Pipeline');
    const flow = doc.nodes.find((node) => node.id === flowId)!;
    expect(flow.name).toBe('Pipeline');
    // Children must follow the rename, or they orphan out of the subgraph.
    for (const child of doc.nodes.filter((node) => node.kind !== 'process')) {
      expect(child.container).toBe('Pipeline');
    }
  });
});

describe('stable container linkage (containerId)', () => {
  it('parses nested members with containerId pointing at the parent node', () => {
    const source = `model Swarm {
  agent Drone {
    count = 3
    on_tick { flip active }
  }
}
`;
    const parsed = parseDsl(source);
    expect(parsed.ok).toBe(true);
    const drone = parsed.document.nodes.find((node) => node.name === 'Drone')!;
    const tick = parsed.document.nodes.find((node) => node.kind === 'on_tick')!;
    const flip = parsed.document.nodes.find((node) => node.name === 'flip active')!;
    expect(tick.containerId).toBe(drone.id);
    expect(tick.container).toBe('Drone');
    // The behavior's effect children link to the BEHAVIOR node.
    expect(flip.containerId).toBe(tick.id);
    expect(childrenOfContainer(parsed.document, drone).map((node) => node.kind)).toEqual([
      'on_tick',
    ]);
    expect(parentOfNode(parsed.document, tick)?.id).toBe(drone.id);
    expect(isRootMember(drone)).toBe(true);
    expect(isRootMember(tick)).toBe(false);
  });

  it('removing an id-linked agent container removes its whole subgraph', () => {
    const parsed = parseDsl(`model Swarm {
  resource Base { capacity = 1 }
  agent Drone {
    on_tick { bounce }
  }
}
`);
    expect(parsed.ok).toBe(true);
    const doc = parsed.document;
    const droneId = doc.nodes.find((node) => node.name === 'Drone')!.id;
    const next = removeNode(doc, droneId);
    // The agent's behavior and its effects used to orphan (invisible on the
    // root canvas, dropped by DSL emission); they must go with the agent.
    expect(next.nodes.map((node) => node.name)).toEqual(['Base']);
  });

  it('renaming re-syncs only the name field of id-linked children', () => {
    let doc = addNode(createDocument('M'), { kind: 'agent', name: 'Worker', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 1, y: 1, container: 'Worker' });
    const worker = doc.nodes[0]!;
    const queue = doc.nodes[1]!;
    expect(queue.containerId).toBeUndefined(); // legacy hand-built child
    doc = renameNode(doc, worker.id, 'Falcon');
    // Legacy name-only children still follow the cascade...
    expect(doc.nodes[1]!.container).toBe('Falcon');
    // ...while an id-linked child keeps its link across renames untouched.
    const relinked = {
      ...doc,
      nodes: doc.nodes.map((node) =>
        node.id === queue.id ? { ...node, containerId: worker.id } : node,
      ),
    };
    const after = renameNode(relinked, worker.id, 'Goliath');
    expect(after.nodes[1]!.containerId).toBe(worker.id);
    expect(after.nodes[1]!.container).toBe('Goliath');
    expect(childrenOfContainer(after, after.nodes[0]!).map((node) => node.name)).toEqual(['Q']);
  });
});
