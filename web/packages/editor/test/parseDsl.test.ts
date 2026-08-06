import { describe, expect, it } from 'vitest';
import {
  generateDsl,
  parseDsl,
  type ModelDocument,
  type ModelEdge,
  type ModelNode,
} from '../src/index.js';

const MM1_DSL = `model MM1 {
  use process
  param arrival_rate: float = 0.8
  resource Server {
    capacity = 1
    failure_rate = 0.05
  }
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
  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
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
    expect(doc.nodes).toHaveLength(7);
    expect(doc.edges).toHaveLength(3);

    // Agent-centric: the flow blocks are direct model members (no `process`
    // container node).
    expect(doc.nodes.find((node) => node.kind === 'process')).toBeUndefined();
    const source = doc.nodes.find((node) => node.kind === 'source')!;
    expect(source.name).toBe('Arrivals');
    expect(source.container).toBeUndefined();

    const resource = doc.nodes.find((node) => node.kind === 'resource')!;
    expect(resource.name).toBe('Server');
    expect(resource.params['capacity']).toBe(1);
    expect(resource.params['failure_rate']).toBe(0.05);

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
  source In { arrival = rate(1) }
  selectOutput Route { probability = 0.5 }
  sink Yes { }
  sink No { }
  couple In.out -> Route.in
  couple Route.outT -> Yes.in
  couple Route.outF -> No.in
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

  it('parses a process block as a placeholder (container format abandoned)', () => {
    const result = parseDsl('model M {\n  process Empty {\n  }\n}\n');
    expect(result.ok).toBe(true);
    const doc = result.document;
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]!.kind).toBe('process');
    expect(doc.nodes[0]!.name).toBe('Empty');
    expect(doc.nodes[0]!.placeholder).toBe(true);
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

describe('full DSL round-trip (parse -> generate -> parse)', () => {
  const memberKey = (node: Pick<ModelNode, 'kind' | 'name' | 'container'>) =>
    `${node.kind}|${node.name}|${node.container ?? ''}`;
  const memberSet = (document: ModelDocument) =>
    document.nodes.map(memberKey).sort();
  const paramMap = (document: ModelDocument) => {
    const map = new Map<string, string>();
    for (const node of document.nodes) {
      map.set(memberKey(node), JSON.stringify(node.params));
    }
    return map;
  };
  const edgeSet = (document: ModelDocument) =>
    document.edges
      .map((edge: ModelEdge) => {
        const from = document.nodes.find((node) => node.id === edge.from)!.name;
        const to = document.nodes.find((node) => node.id === edge.to)!.name;
        return `${from}.${edge.fromPort ?? 'out'}->${to}.${edge.toPort ?? 'in'}`;
      })
      .sort();

  /** Lossless invariant for any legal DSL subset:
   *  parse(source) == parse(generate(parse(source))) on members, params and
   *  edges, and generate is idempotent after one parse. */
  const expectRoundTrip = (source: string) => {
    const first = parseDsl(source);
    expect(first.ok).toBe(true);
    const generated = generateDsl(first.document);
    const second = parseDsl(generated);
    expect(second.ok).toBe(true);
    expect(generateDsl(second.document)).toBe(generated);
    expect(memberSet(second.document)).toEqual(memberSet(first.document));
    expect(paramMap(second.document)).toEqual(paramMap(first.document));
    expect(edgeSet(second.document)).toEqual(edgeSet(first.document));
    return { first, generated, second };
  };

  it('round-trips the full grammar: process flow, agent behaviors, continuous ODE, experiment', () => {
    const source = `model Foundry {
  use process
  param arrival_rate: float = 0.8
  param seed: int = 7
  resource Server {
    capacity = 1
    failure_rate = 0.05
  }
  source Arrivals {
    arrival = rate(0.8)
  }
  queue WaitLine {
    capacity = 100
  }
  selectOutput Route {
    condition = t < 3
    probability = 0.5
  }
  hold Gate {
    blockingCondition = t >= 10
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  sink Done {
  }
  agent Drone {
    count = 3
    state active: bool = true
    param speed: float = 1.5
    on_tick {
      flip active
    }
    on_tick {
      bounce
    }
    on_timeout ready {
      emit ready
    }
  }
  continuous Dynamics {
    state y: float = 1.0
    param k = 0.5
    d y/dt = -k*y
  }
  experiment Tune {
    objective = minimize
    variable = arrival_rate
    budget = 20
  }
  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Route.in
  couple Route.outT -> Handle.in
  couple Route.outF -> Gate.in
  couple Gate.out -> Done.in
}
`;
    const { generated } = expectRoundTrip(source);
    // Comparison expressions stay unquoted expressions, not string literals.
    // Token spacing is normalized (`t < 3` -> `t<3`), but the tokens and
    // semantics survive: the value stays an expression, never a string.
    expect(generated).toContain('condition = t<3');
    expect(generated).toContain('blockingCondition = t>=10');
    expect(generated).not.toContain('"t < 3"');
    // Both on_tick behaviors and the ported on_timeout survive.
    expect(generated).toContain('on_timeout ready {');
    expect(generated).toContain('emit ready');
    expect(generated).toContain('state active: bool = true');
    expect(generated).toContain('d y/dt = -k*y');
    expect(generated).toContain('couple Route.outT -> Handle.in');
    expect(generated).toContain('couple Route.outF -> Gate.in');
  });

  it('keeps multiple behaviors grouped by their own effects', () => {
    const { generated } = expectRoundTrip(`model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick {
      flip active
    }
    on_tick {
      bounce
    }
  }
}
`);
    // Each behavior block gets exactly its own effect: flip in the first,
    // bounce in the second (previously both were merged into every block).
    const first = generated.indexOf('on_tick {');
    const second = generated.indexOf('on_tick {', first + 1);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(generated.slice(first, second)).toContain('flip active');
    expect(generated.slice(first, second)).not.toContain('bounce');
    expect(generated.slice(second)).toContain('bounce');
    expect(generated.slice(second)).not.toContain('flip active');
  });

  it('round-trips unknown custom block kinds and bare effect lines', () => {
    expectRoundTrip(`model M {
  use customlib
  myblock X {
    rate = 2.5
    mode = fast
    label = "hello world"
  }
  widget W {
    on_click {
      fire
      set state = 1
    }
  }
}
`);
  });

  it('preserves quoted strings as strings and identifiers bare', () => {
    const { generated } = expectRoundTrip(`model M {
  service S {
    resource = Server
    label = "hello world"
  }
}
`);
    expect(generated).toContain('label = "hello world"');
    expect(generated).toContain('resource = Server');
  });

  it('warns on same-name nested containers but never crashes', () => {
    const source = `model M {
  agent A {
    state x = 1
    agent A {
      state y = 2
    }
  }
}
`;
    const first = parseDsl(source);
    expect(first.ok).toBe(true);
    expect(
      first.diagnostics!.some(
        (diagnostic) => diagnostic.code === 'LP3103' && diagnostic.severity === 'warning',
      ),
    ).toBe(true);
    // Generating the ambiguous tree terminates (no self-recursion) and the
    // re-parse stays valid. The tree itself is warned as non-lossless, so we
    // only assert termination + the warning, not exact member equality.
    const generated = generateDsl(first.document);
    expect(generated.length).toBeGreaterThan(0);
    const second = parseDsl(generated);
    expect(second.ok).toBe(true);
  });

  it('parses comparison operators without spaces', () => {
    const result = parseDsl(`model M {
  hold Gate {
    blockingCondition = t<=5
  }
}
`);
    expect(result.ok).toBe(true);
    const gate = result.document.nodes.find((node) => node.kind === 'hold')!;
    expect(gate.params['blockingCondition']).toBe('t<=5');
    expectRoundTrip(`model M {
  hold Gate {
    blockingCondition = t<=5
  }
}
`);
  });
});
