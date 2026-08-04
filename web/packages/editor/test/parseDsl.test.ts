import { describe, expect, it } from 'vitest';
import { generateDsl, parseDsl } from '../src/index.js';

const MM1_DSL = `model MM1 {
  use process
  param arrival_rate: float = 0.8
  resource Server {
    capacity = 1
    failure_rate = 0.05
  }
  process Flow {
    source Arrivals {
      arrival = rate(0.8)
    }
    queue WaitLine {
      capacity = 100
    }
    service Handle {
      resource = Server
      time = exponential(1.0)
    }
    sink Done {
    }
  }
}
`;

describe('parseDsl', () => {
  it('parses a process model into a canvas document', () => {
    const result = parseDsl(MM1_DSL);
    expect(result.ok).toBe(true);
    const doc = result.document;
    expect(doc.name).toBe('MM1');
    expect(doc.nodes).toHaveLength(5);
    expect(doc.edges).toHaveLength(3);

    const resource = doc.nodes.find((node) => node.kind === 'resource')!;
    expect(resource.name).toBe('Server');
    expect(resource.params['capacity']).toBe(1);
    expect(resource.params['failure_rate']).toBe(0.05);

    const source = doc.nodes.find((node) => node.kind === 'source')!;
    expect(source.name).toBe('Arrivals');
    expect(source.params['arrival']).toBe('rate(0.8)');

    const service = doc.nodes.find((node) => node.kind === 'service')!;
    expect(service.params['resource']).toBe('Server');
    expect(service.params['time']).toBe('exponential(1.0)');

    // Stages couple in declaration order.
    const kinds = doc.nodes.filter((node) => node.kind !== 'resource').map((node) => node.kind);
    expect(kinds).toEqual(['source', 'queue', 'service', 'sink']);
  });

  it('round-trips through generateDsl', () => {
    const result = parseDsl(MM1_DSL);
    expect(result.ok).toBe(true);
    const regenerated = generateDsl(result.document);
    expect(regenerated).toContain('model MM1 {');
    expect(regenerated).toContain('resource Server {');
    expect(regenerated).toContain('arrival = rate(0.8)');
    expect(regenerated).toContain('time = exponential(1.0)');
    expect(regenerated).toContain('sink Done { }');
  });

  it('rejects models without a process flow', () => {
    const result = parseDsl('model Decay { continuous x { rate = 0.5 } }');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('process');
  });

  it('rejects malformed source', () => {
    const result = parseDsl('model { source A { } }');
    expect(result.ok).toBe(false);
  });
});
