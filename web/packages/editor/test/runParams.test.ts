import { describe, expect, it } from 'vitest';
import { addNode, createDocument, modelRunParams } from '../src/index.js';

function mm1Doc() {
  let doc = createDocument('MM1');
  doc = addNode(doc, {
    kind: 'resource',
    name: 'Server',
    x: 0,
    y: 0,
    params: { capacity: 2, failure_rate: 0.05 },
  });
  doc = addNode(doc, {
    kind: 'source',
    name: 'Arrivals',
    x: 0,
    y: 40,
    params: { arrival: 'poisson(10)' },
  });
  doc = addNode(doc, {
    kind: 'queue',
    name: 'WaitLine',
    x: 100,
    y: 40,
    params: { capacity: 100 },
  });
  doc = addNode(doc, {
    kind: 'service',
    name: 'Handle',
    x: 200,
    y: 40,
    params: { resource: 'Server', time: 'exponential(2)' },
  });
  doc = addNode(doc, { kind: 'sink', name: 'Done', x: 300, y: 40 });
  return doc;
}

describe('modelRunParams', () => {
  it('maps an mm1-shaped canvas model to the streaming driver params', () => {
    const params = modelRunParams(mm1Doc());
    expect(params.ok).toBe(true);
    expect(params).toMatchObject({
      lambda: 10,
      mu: 2,
      servers: 2,
      failureRate: 0.05,
      repairRate: 1,
    });
  });

  it('rejects models without exactly one source and service', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'A', x: 0, y: 0, params: { arrival: 'rate(1)' } });
    expect(modelRunParams(doc).ok).toBe(false);
  });

  it('rejects non-exponential service times', () => {
    let doc = mm1Doc();
    const service = doc.nodes.find((node) => node.kind === 'service')!;
    doc = {
      ...doc,
      nodes: doc.nodes.map((node) =>
        node.id === service.id
          ? { ...node, params: { ...node.params, time: 'normal(20,5)' } }
          : node,
      ),
    };
    const params = modelRunParams(doc);
    expect(params.ok).toBe(false);
    expect(params.error).toContain('exponential');
  });

  it('rejects a service referencing an unknown resource', () => {
    let doc = mm1Doc();
    const service = doc.nodes.find((node) => node.kind === 'service')!;
    doc = {
      ...doc,
      nodes: doc.nodes.map((node) =>
        node.id === service.id
          ? { ...node, params: { ...node.params, resource: 'Missing' } }
          : node,
      ),
    };
    const params = modelRunParams(doc);
    expect(params.ok).toBe(false);
    expect(params.error).toContain('Missing');
  });

  it('accepts a standalone statechart model without driver params', () => {
    let doc = createDocument('TrafficLight');
    doc = addNode(doc, {
      kind: 'statechart',
      name: 'Light',
      x: 0,
      y: 0,
      library: 'statechart',
      params: {},
    });
    doc = addNode(doc, {
      kind: 'state',
      name: 'Red',
      x: 0,
      y: 40,
      library: 'statechart',
      container: 'Light',
      params: {},
    });
    const params = modelRunParams(doc);
    expect(params.ok).toBe(true);
    expect(params.lambda).toBeUndefined();
  });
});
