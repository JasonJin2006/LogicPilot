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
    // use/param are now kept as model members (placeholder nodes), so the
    // full grammar round-trips losslessly.
    expect(doc.nodes).toHaveLength(8);
    expect(doc.edges).toHaveLength(3);

    const container = doc.nodes.find((node) => node.kind === 'process')!;
    expect(container.name).toBe('Flow');
    expect(container.container).toBeUndefined();

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

    expect(doc.nodes.find((node) => node.kind === 'use')!.name).toBe('process');
    expect(doc.nodes.find((node) => node.kind === 'param')!.name).toBe('arrival_rate');
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

  it('parses explicit couple declarations with ports', () => {
    const source = `model Demo {
  process Flow {
    source In { arrival = rate(1) }
    selectOutput Route { probability = 0.5 }
    sink Yes { }
    sink No { }
    couple In.out -> Route.in
    couple Route.outT -> Yes.in
    couple Route.outF -> No.in
  }
}`;
    const result = parseDsl(source);
    expect(result.ok).toBe(true);
    const doc = result.document;
    expect(doc.edges).toHaveLength(3);
    const routeEdge = doc.edges.find(
      (edge) => edge.fromPort === 'outT' || edge.fromPort === 'outF',
    );
    expect(routeEdge).toBeDefined();
    const byName = new Map(doc.nodes.map((node) => [node.name, node.id]));
    const route = doc.nodes.find((node) => node.kind === 'selectOutput')!;
    const yes = doc.nodes.find((node) => node.name === 'Yes')!;
    const edge = doc.edges.find(
      (entry) => entry.from === route.id && entry.to === yes.id,
    );
    expect(edge?.fromPort).toBe('outT');
    expect(edge?.toPort).toBeUndefined();  // default 'in' normalized away
    expect(byName.has('In')).toBe(true);
  });

  it('parses the full grammar: continuous/agent/experiment with placeholders', () => {
    const source = `model Swarm {
  param seed: int = 7
  agent Drone {
    count = 3
    state active: bool = true
    on_tick {
      flip active
    }
  }
  continuous Dynamics {
    state y: float = 1.0
    param k = 0.5
    d y/dt = -k*y
  }
  experiment Tune {
    objective = minimize Wq
    variable = arrival_rate
    budget = 20
  }
}
`;
    const result = parseDsl(source);
    expect(result.ok).toBe(true);
    const doc = result.document;
    const agent = doc.nodes.find((node) => node.kind === 'agent')!;
    expect(agent.name).toBe('Drone');
    // count/state became params, the behavior block a child node.
    expect(agent.params['count']).toBe(3);
    expect(agent.params['state active: bool']).toBe(true);
    const behavior = doc.nodes.find((node) => node.kind === 'on_tick')!;
    expect(behavior.container).toBe('Drone');
    const continuous = doc.nodes.find((node) => node.kind === 'continuous')!;
    expect(continuous.name).toBe('Dynamics');
    // The ODE equation is a container field, merged into the container's
    // params (kept verbatim so the round trip is lossless).
    expect(continuous.params['d y/dt']).toBe('-k*y');
    // Round trip is lossless: re-parsing the generated DSL yields the same
    // member set.
    const regenerated = generateDsl(doc);
    const reparsed = parseDsl(regenerated);
    expect(reparsed.ok).toBe(true);
    const kinds = reparsed.document.nodes.map((node) => node.kind).sort();
    expect(kinds).toEqual(doc.nodes.map((node) => node.kind).sort());
    expect(regenerated).toContain('agent Drone');
    expect(regenerated).toContain('state active: bool = true');
    expect(regenerated).toContain('experiment Tune');
  });

  it('parses an empty process container into a canvas container node', () => {
    const result = parseDsl('model M {\n  process Empty {\n  }\n}\n');
    expect(result.ok).toBe(true);
    const doc = result.document;
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]!.kind).toBe('process');
    expect(doc.nodes[0]!.name).toBe('Empty');
    expect(doc.edges).toHaveLength(0);
  });

  it('rejects malformed source', () => {
    const result = parseDsl('model { source A { } }');
    expect(result.ok).toBe(false);
  });

  it('reports duplicate member names as LP3103', () => {
    const result = parseDsl(
      'model M {\n  resource A {\n    capacity = 1\n  }\n  resource A {\n    capacity = 2\n  }\n}\n',
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics!.some((diagnostic) => diagnostic.code === 'LP3103')).toBe(true);
  });
});
