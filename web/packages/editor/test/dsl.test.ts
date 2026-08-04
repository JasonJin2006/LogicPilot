import { describe, expect, it } from 'vitest';
import { addNode, connect, createDocument, generateDsl } from '../src/index.js';

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

    const source = generateDsl(doc);
    expect(source).toContain('model MM1 {');
    expect(source).toContain('resource Server {');
    expect(source).toContain('capacity = 1');
    expect(source).toContain('process Flow {');
    expect(source).toContain('source Arrivals {');
    expect(source).toContain('arrival = rate(0.8)');
    expect(source).toContain('queue WaitLine {');
    expect(source).toContain('capacity = 1000000');
    expect(source).toContain('service Handle {');
    expect(source).toContain('resource = Server');
    expect(source).toContain('time = exponential(1.0)');
    expect(source).toContain('sink Done { }');
    expect(source).toContain('}');
  });

  it('orders process stages by canvas x position', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 200, y: 0 });
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0 });
    const source = generateDsl(doc);
    expect(source.indexOf('source A')).toBeLessThan(source.indexOf('queue Q'));
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
});
