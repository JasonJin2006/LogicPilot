import { describe, expect, it } from 'vitest';
import { addNode, connect, createDocument, generateDsl, parseDsl } from '../src/index.js';

describe('DSL v2 generation', () => {
  it('renders a mm1-equivalent document to DSL v2', () => {
    let doc = createDocument('MM1');
    doc = addNode(doc, {
      kind: 'resource',
      name: 'Server',
      x: 0,
      y: 0,
      params: { capacity: 1 },
    });
    doc = addNode(doc, {
      kind: 'source',
      name: 'Arrivals',
      x: 0,
      y: 40,
      params: { arrival: 'rate(0.8)' },
    });
    doc = addNode(doc, {
      kind: 'queue',
      name: 'WaitLine',
      x: 100,
      y: 40,
      params: { capacity: 1000000 },
    });
    doc = addNode(doc, {
      kind: 'service',
      name: 'Handle',
      x: 200,
      y: 40,
      params: { resource: 'Server', time: 'exponential(1.0)' },
    });
    doc = addNode(doc, { kind: 'sink', name: 'Done', x: 300, y: 40 });
    const nodes = doc.nodes;
    doc = connect(doc, nodes[1]!.id, nodes[2]!.id).document;
    doc = connect(doc, nodes[2]!.id, nodes[3]!.id).document;
    doc = connect(doc, nodes[3]!.id, nodes[4]!.id).document;

    const source = generateDsl(doc);
    expect(source).toContain('model MM1 {');
    expect(source).toContain('resource Server {');
    expect(source).toContain('capacity = 1');
    // Agent-centric: process blocks emit directly at the model root.
    expect(source).toContain('source Arrivals {');
    expect(source).toContain('arrival = rate(0.8)');
    expect(source).toContain('queue WaitLine {');
    expect(source).toContain('capacity = 1000000');
    expect(source).toContain('service Handle {');
    expect(source).toContain('resource = Server');
    expect(source).toContain('time = exponential(1.0)');
    expect(source).toContain('sink Done { }');
    expect(source).toContain("couple Arrivals.out -> WaitLine.in");
    expect(source).toContain("couple WaitLine.out -> Handle.in");
    expect(source).toContain("couple Handle.out -> Done.in");
    expect(source).toContain('}');
  });

  it('orders process stages by canvas x position', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 200, y: 0 });
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0 });
    const source = generateDsl(doc);
    expect(source.indexOf('source A')).toBeLessThan(source.indexOf('queue Q'));
  });

  it('emits explicit couple lines for non-default ports', () => {
    let doc = createDocument();
    doc = addNode(doc, {
      kind: 'source',
      name: 'In',
      x: 0,
      y: 0,
      library: 'process',
    });
    doc = addNode(doc, {
      kind: 'selectOutput',
      name: 'Route',
      x: 200,
      y: 0,
      library: 'process',
    });
    doc = addNode(doc, {
      kind: 'sink',
      name: 'Yes',
      x: 400,
      y: -100,
      library: 'process',
    });
    doc = addNode(doc, {
      kind: 'sink',
      name: 'No',
      x: 400,
      y: 100,
      library: 'process',
    });
    doc = connect(doc, doc.nodes[0]!.id, doc.nodes[1]!.id).document;
    doc = connect(doc, doc.nodes[1]!.id, doc.nodes[2]!.id, 'outT', 'in').document;
    doc = connect(doc, doc.nodes[1]!.id, doc.nodes[3]!.id, 'outF', 'in').document;

    const source = generateDsl(doc);
    expect(source).toContain("couple In.out -> Route.in");
    expect(source).toContain("couple Route.outT -> Yes.in");
    expect(source).toContain("couple Route.outF -> No.in");
  });

  it('orders process stages by coupling edges (topological, x fallback)', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'service', name: 'S', x: 0, y: 0 });
    const serviceId = doc.nodes[0]!.id;
    doc = addNode(doc, { kind: 'source', name: 'A', x: 100, y: 0 });
    const sourceId = doc.nodes[1]!.id;
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 200, y: 0 });
    const queueId = doc.nodes[2]!.id;
    doc = addNode(doc, { kind: 'sink', name: 'D', x: 300, y: 0 });
    const sinkId = doc.nodes[3]!.id;
    doc = connect(doc, sourceId, queueId).document;
    doc = connect(doc, queueId, serviceId).document;
    doc = connect(doc, serviceId, sinkId).document;
    const source = generateDsl(doc);
    const indexOf = (needle: string) => source.indexOf(needle);
    expect(indexOf('source A')).toBeLessThan(indexOf('queue Q'));
    expect(indexOf('queue Q')).toBeLessThan(indexOf('service S'));
    expect(indexOf('service S')).toBeLessThan(indexOf('sink D'));
  });

  it('serializes identifiers bare and free-form strings quoted', () => {
    let doc = createDocument();
    doc = addNode(doc, {
      kind: 'service',
      name: 'S',
      x: 0,
      y: 0,
      params: { resource: 'Server', label: 'hello world' },
    });
    const source = generateDsl(doc);
    expect(source).toContain('resource = Server');
    expect(source).toContain('label = "hello world"');
  });

  it('passes distribution calls through unquoted', () => {
    let doc = createDocument();
    doc = addNode(doc, {
      kind: 'source',
      name: 'A',
      x: 0,
      y: 0,
      params: { arrival: 'poisson(10)' },
    });
    const source = generateDsl(doc);
    expect(source).toContain('arrival = poisson(10)');
    expect(source).not.toContain('"poisson');
  });

  it('emits custom-library block kinds as model members', () => {
    let doc = createDocument();
    doc = addNode(doc, {
      kind: 'myblock' as Parameters<typeof addNode>[1]['kind'],
      name: 'X',
      x: 0,
      y: 0,
      params: { rate: 1 },
    });
    const source = generateDsl(doc);
    expect(source).toContain('myblock X {');
    expect(source).toContain('rate = 1');
  });

  it('skips drawing and behavior elements (non-process libraries)', () => {
    let doc = createDocument();
    doc = addNode(doc, {
      kind: 'rect' as Parameters<typeof addNode>[1]['kind'],
      name: 'Box',
      x: 0,
      y: 0,
      library: 'presentation',
    });
    doc = addNode(doc, {
      kind: 'state' as Parameters<typeof addNode>[1]['kind'],
      name: 'Idle',
      x: 100,
      y: 0,
      library: 'statechart',
    });
    const source = generateDsl(doc);
    expect(source).not.toContain('rect');
    expect(source).not.toContain('state');
  });

});
