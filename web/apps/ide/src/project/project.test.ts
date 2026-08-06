import { describe, expect, it } from 'vitest';
import { addNode, connect, createDocument, defaultPresentationObject } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import { parseProjectSource } from './projectTree';
import {
  PROJECT_SCHEMA,
  DEFAULT_MODEL_PATH,
  addInstanceLine,
  bundleToJson,
  createProject,
  createProjectBundle,
  initializeProject,
  mergeCanvasSplit,
  mergeModelSource,
  nextInstanceName,
  parseProjectBundle,
  projectToDocument,
  sceneContainerFromFile,
  splitModelSource,
} from './project';

function buildSample(): ModelDocument {
  let document = createDocument('MM1');
  document = addNode(document, {
    kind: 'resource',
    name: 'Server',
    x: 40,
    y: 60,
    params: { capacity: 1 },
  });
  document = addNode(document, {
    kind: 'source',
    name: 'Arrivals',
    x: 120,
    y: 200,
    params: { arrival: 'rate(0.8)' },
  });
  document = addNode(document, {
    kind: 'queue',
    name: 'WaitLine',
    x: 300,
    y: 200,
    params: { capacity: 100 },
  });
  document = addNode(document, {
    kind: 'service',
    name: 'Handle',
    x: 480,
    y: 200,
    params: { time: 'exponential(1.0)' },
  });
  document = addNode(document, {
    kind: 'sink',
    name: 'Done',
    x: 660,
    y: 200,
    params: {},
  });
  document = connect(document, document.nodes[1]!.id, document.nodes[2]!.id).document;
  return document;
}

describe('project bundle', () => {
  it('createProject builds an empty bundle with the given name and seed', () => {
    const bundle = createProject('MyFactory', 7);
    expect(bundle.manifest.name).toBe('MyFactory');
    expect(bundle.manifest.defaults.seed).toBe(7);
    expect(bundle.manifest.defaults.schemaVersion).toBe(2);
    expect(bundle.files['model/main.lp']).toContain('model MyFactory');
    const loaded = projectToDocument(bundle);
    expect(loaded.ok).toBe(true);
    expect(loaded.document!.name).toBe('MyFactory');
    expect(loaded.document!.nodes).toHaveLength(0);
    expect(loaded.document!.edges).toHaveLength(0);
  });

  it('createProject defaults the seed when omitted', () => {
    expect(createProject('Plain').manifest.defaults.seed).toBe(42);
  });

  it('initializeProject builds a bundle from a bare folder main.lp', () => {
    const { document, bundle } = initializeProject(
      'model M {\n  resource R {\n    capacity = 2\n  }\n}\n',
      'my-folder',
    );
    expect(bundle.manifest.name).toBe('my-folder');
    expect(bundle.files['model/main.lp']).toContain('model M');
    expect(document.nodes.find((node) => node.kind === 'resource')!.params['capacity']).toBe(2);
  });

  it('initializeProject falls back to an empty model without main.lp', () => {
    const { document, bundle } = initializeProject(undefined, 'empty-folder');
    expect(bundle.manifest.name).toBe('empty-folder');
    expect(document.nodes).toHaveLength(0);
    expect(bundle.files['model/main.lp']).toContain('model empty-folder');
  });

  it('createProject keeps all members in the owning container files', () => {
    const bundle = createProject('Factory');
    expect(bundle.manifest.modelParts).toEqual([]);
    expect(bundle.files['model/main.lp']).toContain('model Factory');
    expect(bundle.files['model/resources.lp']).toBeUndefined();
    expect(bundle.files['model/experiments.lp']).toBeUndefined();
    const loaded = projectToDocument(bundle);
    expect(loaded.ok).toBe(true);
  });

  it('splitModelSource keeps process blocks in main.lp and nested containers in scenes', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  source In {
    arrival = rate(0.8)
  }
  queue Q {
    capacity = 10
  }
  agent Drone {
    count = 2
  }
  experiment Tune {
    budget = 20
  }
}
`;
    const split = splitModelSource(source);
    expect(split['model/main.lp']).toContain('model M');
    expect(split['model/main.lp']).toContain('resource Server');
    expect(split['model/main.lp']).toContain('source In');
    expect(split['model/main.lp']).toContain('queue Q');
    expect(split['model/main.lp']).toContain('instance Drone = "model/scenes/Drone.lp"');
    expect(split['model/main.lp']).toContain('instance Tune = "model/scenes/Tune.lp"');
    expect(split['model/scenes/Flow.lp']).toBeUndefined();
    expect(split['model/scenes/Drone.lp']).toContain('agent Drone');
    expect(split['model/scenes/Tune.lp']).toContain('experiment Tune');
    expect(split['model/resources.lp']).toBeUndefined();
    expect(split['model/experiments.lp']).toBeUndefined();
    // Members keep their model-body indentation so the merged model stays tidy.
    expect(split['model/main.lp']).toMatch(/  resource Server/);
    expect(split['model/scenes/Drone.lp']).toMatch(/^\/\/ @uid lp_[0-9a-f]{16}/);
  });

  it('mergeModelSource reconstructs the full model from parts', () => {
    const main = 'model M {\n  instance Drone = "model/scenes/Drone.lp"\n}\n';
    const files = {
      'model/main.lp': main,
      'model/resources.lp': '  resource Server {\n    capacity = 1\n  }\n',
      'model/scenes/Drone.lp': '  agent Drone {\n    count = 2\n  }\n',
      'model/experiments.lp': '  experiment Tune {\n    budget = 20\n  }\n',
    };
    const merged = mergeModelSource(main, files);
    expect(merged).toContain('resource Server');
    expect(merged).toContain('agent Drone');
    expect(merged).toContain('experiment Tune');
    const parsed = parseProjectSource(merged);
    expect(parsed.ok).toBe(true);
    expect(new Set(parsed.model!.members.map((member) => member.kind))).toEqual(
      new Set(['resource', 'agent', 'experiment']),
    );
  });

  it('split then merge is lossless for flat flows and nested containers', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  source S {
    arrival = rate(0.8)
  }
}
`;
    const split = splitModelSource(source);
    const main = split['model/main.lp']!;
    const merged = mergeModelSource(main, split);
    const original = parseProjectSource(source);
    const reparsed = parseProjectSource(merged);
    expect(reparsed.ok).toBe(true);
    expect(new Set(reparsed.model!.members.map((m) => m.kind))).toEqual(
      new Set(original.model!.members.map((m) => m.kind)),
    );
    expect(merged).toContain('arrival = rate(0.8)');
  });

  it('mergeCanvasSplit keeps container scenes the canvas does not own', () => {
    const base = createProjectBundle(buildSample());
    const split = splitModelSource(base.files[DEFAULT_MODEL_PATH]!);
    const current = createProject('Keep');
    current.files['model/scenes/Keep.lp'] = '  agent Keep {\n    count = 1\n  }\n';
    const merged = mergeCanvasSplit(base, split, current);
    expect(merged.files['model/scenes/Keep.lp']).toContain('agent Keep');
    expect(merged.manifest.modelParts).toEqual([]);
  });

  it('sceneContainerFromFile identifies the container of a scene file', () => {
    expect(
      sceneContainerFromFile('model/scenes/Drone.lp', '  agent Drone {\n    count = 2\n  }\n'),
    ).toEqual({ kind: 'agent', name: 'Drone' });
    expect(sceneContainerFromFile('model/main.lp', 'model M {\n}\n')).toBeNull();
    expect(sceneContainerFromFile('model/scenes/Bad.lp', 'not a fragment')).toBeNull();
  });

  it('projectTree parses instance members', () => {
    const parsed = parseProjectSource('model M {\n  instance Drone = "model/scenes/Drone.lp"\n}\n');
    expect(parsed.ok).toBe(true);
    const instance = parsed.model!.members.find((member) => member.kind === 'instance')!;
    expect(instance.name).toBe('Drone');
    expect(instance.path).toBe('model/scenes/Drone.lp');
  });

  it('addInstanceLine inserts an instance member into the model body', () => {
    const source = 'model M {\n  resource Server { }\n}\n';
    const next = addInstanceLine(source, 'model/scenes/Drone.lp', 'Drone');
    expect(next).toContain('instance Drone = "model/scenes/Drone.lp"');
    const reparsed = parseProjectSource(next);
    expect(reparsed.ok).toBe(true);
    const instance = reparsed.model!.members.find((member) => member.kind === 'instance')!;
    expect(instance.name).toBe('Drone');
    expect(instance.path).toBe('model/scenes/Drone.lp');
    // The inserted member lives inside the model body, before the closing brace.
    expect(next.indexOf('instance Drone')).toBeLessThan(next.indexOf('\n}\n'));
  });

  it('nextInstanceName avoids collisions with existing members', () => {
    const source =
      'model M {\n  instance Drone = "model/scenes/Drone.lp"\n  instance Drone2 = "model/scenes/Drone2.lp"\n}\n';
    expect(nextInstanceName(source, 'Drone')).toBe('Drone3');
    expect(nextInstanceName(source, 'New')).toBe('New');
    expect(nextInstanceName('model M {\n}\n', 'Drone')).toBe('Drone');
  });

  it('split emits instances and merge resolves them back to inline containers', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  agent Drone {
    count = 2
  }
}
`;
    const split = splitModelSource(source);
    expect(split['model/main.lp']).toContain('instance Drone = "model/scenes/Drone.lp"');
    expect(split['model/scenes/Drone.lp']).toContain('agent Drone');
    expect(split['model/main.lp']).toContain('resource Server');

    const merged = mergeModelSource(split['model/main.lp']!, split);
    expect(merged).not.toContain('instance Drone');
    expect(merged).toContain('agent Drone');
    expect(merged).toContain('count = 2');
    const reparsed = parseProjectSource(merged);
    expect(reparsed.ok).toBe(true);
    expect(new Set(reparsed.model!.members.map((member) => member.kind))).toEqual(
      new Set(['resource', 'agent']),
    );
  });

  it('round-trips the canvas layout (positions and edges survive by path)', () => {
    const original = buildSample();
    const result = projectToDocument(createProjectBundle(original));
    expect(result.ok).toBe(true);
    const document = result.document!;
    expect(document.name).toBe('MM1');
    // Agent-centric: bare stages stay at the model root (no synthetic
    // `process Flow` container), so the reloaded document has exactly the
    // five authored nodes.
    expect(document.nodes).toHaveLength(5);
    expect(document.edges).toHaveLength(1);
    // Positions are keyed by stable node path, not runtime ids.
    const arrivals = document.nodes.find((node) => node.name === 'Arrivals')!;
    expect(arrivals.x).toBe(120);
    const waitLine = document.nodes.find((node) => node.name === 'WaitLine')!;
    expect(waitLine.y).toBe(200);
    const service = document.nodes.find((node) => node.name === 'Handle')!;
    expect(service.params).toEqual({ time: 'exponential(1.0)' });
    expect(document.nodes.find((node) => node.name === 'Server')!.x).toBe(40);
  });

  it('applies the layout to nested container members by path', () => {
    let document = createDocument('Swarm');
    document = addNode(document, { kind: 'agent', name: 'Drone', x: 300, y: 400, params: {} });
    document = addNode(document, {
      kind: 'on_tick',
      name: 'on_tick',
      x: 120,
      y: 250,
      params: {},
      container: 'Drone',
    });
    const result = projectToDocument(createProjectBundle(document));
    expect(result.ok).toBe(true);
    const reloaded = result.document!;
    const agent = reloaded.nodes.find((node) => node.name === 'Drone')!;
    expect(agent.x).toBe(300);
    expect(agent.y).toBe(400);
    const behavior = reloaded.nodes.find((node) => node.kind === 'on_tick')!;
    expect(behavior.x).toBe(120);
    expect(behavior.y).toBe(250);
  });

  it('reads legacy v1 canvas documents (structure + layout)', () => {
    const bundle = createProjectBundle(buildSample());
    // Simulate a v1 canvas: the whole document JSON.
    const legacy = JSON.stringify(buildSample(), null, 2);
    bundle.files[bundle.manifest.presentation] = legacy;
    const result = projectToDocument(bundle);
    expect(result.ok).toBe(true);
    expect(result.document!.nodes).toHaveLength(5);
    expect(result.document!.nodes[1]!.x).toBe(120);
  });

  it('emits the DSL and canvas files under the canonical paths', () => {
    const bundle = createProjectBundle(buildSample());
    expect(bundle.schema).toBe(PROJECT_SCHEMA);
    expect(bundle.manifest.model).toBe('model/main.lp');
    expect(bundle.manifest.presentation).toBe('presentation/main.canvas.json');
    expect(bundle.manifest.defaults.schemaVersion).toBe(2);
    expect(bundle.files['model/main.lp']).toContain('model MM1');
    // v2 canvas file is layout-only (structure lives in main.lp).
    expect(bundle.files['presentation/main.canvas.json']).toContain('"layout"');
    expect(bundle.files['presentation/main.canvas.json']).not.toContain('"nodes"');
  });

  it('survives a JSON text round trip', () => {
    const bundle = createProjectBundle(buildSample());
    const parsed = parseProjectBundle(bundleToJson(bundle));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle!.manifest.name).toBe('MM1');
    expect(parsed.bundle!.files['model/main.lp']).toContain('source Arrivals');
  });

  it('rejects non-project JSON', () => {
    const parsed = parseProjectBundle('{"hello": 1}');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it('rejects invalid JSON', () => {
    const parsed = parseProjectBundle('{ not json');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('not valid JSON');
  });

  it('falls back to the DSL source when the canvas file is missing', () => {
    const bundle = createProjectBundle(buildSample());
    delete bundle.files[bundle.manifest.presentation];
    const result = projectToDocument(bundle);
    expect(result.ok).toBe(true);
    // parseDsl lays the blocks out (resource + process container + stages)
    // and couples the stages left to right.
    expect(result.document!.nodes).toHaveLength(5);
    expect(result.document!.name).toBe('MM1');
  });

  it('reports a missing model file', () => {
    const bundle = createProjectBundle(buildSample());
    delete bundle.files[bundle.manifest.presentation];
    delete bundle.files[bundle.manifest.model];
    const result = projectToDocument(bundle);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('round-trips presentation shapes through the project bundle', () => {
    let document = buildSample();
    const shape = defaultPresentationObject('rect', 300, 200);
    document = addNode(document, {
      kind: 'rect',
      name: 'rect',
      x: 300,
      y: 200,
      library: 'presentation',
      presentation: shape,
    });
    const bundle = createProjectBundle(document);
    const canvas = JSON.parse(bundle.files[bundle.manifest.presentation]!) as {
      version?: unknown;
      shapes?: Array<{ kind?: unknown; object?: unknown }>;
    };
    expect(canvas.version).toBe(3);
    expect(canvas.shapes).toHaveLength(1);

    const result = projectToDocument(bundle);
    expect(result.ok).toBe(true);
    const restored = result.document!.nodes.find((node) => node.library === 'presentation');
    expect(restored).toBeDefined();
    expect(restored!.presentation?.transform.x).toBe(300);
    expect(restored!.presentation?.transform.width).toBe(120);
    expect(restored!.presentation?.style.fill).toBe('#ffffff');
  });
});
