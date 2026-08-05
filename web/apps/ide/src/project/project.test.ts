import { describe, expect, it } from 'vitest';
import { addNode, connect, createDocument } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import { parseProjectSource } from './projectTree';
import {
  PROJECT_SCHEMA,
  DEFAULT_MODEL_PATH,
  bundleToJson,
  createProject,
  createProjectBundle,
  mergeCanvasSplit,
  mergeModelSource,
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

  it('createProject produces the multi-file part structure', () => {
    const bundle = createProject('Factory');
    expect(bundle.manifest.modelParts).toEqual([
      'model/resources.lp',
      'model/experiments.lp',
    ]);
    expect(bundle.files['model/main.lp']).toContain('model Factory');
    for (const part of bundle.manifest.modelParts ?? []) {
      expect(bundle.files[part]).toBeDefined();
    }
    const loaded = projectToDocument(bundle);
    expect(loaded.ok).toBe(true);
  });

  it('splitModelSource partitions members into per-concern parts', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  process Flow {
    queue Q {
      capacity = 10
    }
  }
  experiment Tune {
    budget = 20
  }
}
`;
    const split = splitModelSource(source);
    expect(split['model/main.lp']).toContain('model M');
    expect(split['model/resources.lp']).toContain('resource Server');
    expect(split['model/scenes/Flow.lp']).toContain('process Flow');
    expect(split['model/experiments.lp']).toContain('experiment Tune');
    expect(split['model/process.lp']).toBeUndefined();
    expect(split['model/scenes/Drone.lp']).toBeUndefined();
    // Parts keep their model-body indentation so the merged model stays tidy.
    expect(split['model/resources.lp']).toMatch(/^  resource Server/);
    expect(split['model/experiments.lp']).toMatch(/^  experiment Tune/);
    expect(split['model/scenes/Flow.lp']).toMatch(/^  process Flow/);
  });

  it('mergeModelSource reconstructs the full model from parts', () => {
    const main = 'model M {\n}\n';
    const files = {
      'model/main.lp': main,
      'model/resources.lp': '  resource Server {\n    capacity = 1\n  }\n',
      'model/scenes/Flow.lp': '  process Flow {\n    queue Q {\n      capacity = 10\n    }\n  }\n',
      'model/experiments.lp': '  experiment Tune {\n    budget = 20\n  }\n',
    };
    const merged = mergeModelSource(main, files);
    expect(merged).toContain('resource Server');
    expect(merged).toContain('queue Q');
    expect(merged).toContain('experiment Tune');
    const parsed = parseProjectSource(merged);
    expect(parsed.ok).toBe(true);
    expect(new Set(parsed.model!.members.map((member) => member.kind))).toEqual(
      new Set(['resource', 'process', 'experiment']),
    );
  });

  it('split then merge is lossless for resources/process/experiments', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  process Flow {
    source S {
      arrival = rate(0.8)
    }
  }
}
`;
    const split = splitModelSource(source);
    const main = split['model/main.lp']!;
    const merged = mergeModelSource(main, split);
    const original = parseProjectSource(source);
    const reparsed = parseProjectSource(merged);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.model!.members.map((m) => m.kind)).toEqual(
      original.model!.members.map((m) => m.kind),
    );
    expect(merged).toContain('arrival = rate(0.8)');
  });

  it('mergeCanvasSplit preserves part files the canvas does not own', () => {
    const base = createProjectBundle(buildSample());
    const split = splitModelSource(base.files[DEFAULT_MODEL_PATH]!);
    const current = createProject('Keep');
    current.files['model/experiments.lp'] =
      '  experiment Tune {\n    budget = 20\n  }\n';
    const merged = mergeCanvasSplit(base, split, current);
    expect(merged.files['model/experiments.lp']).toContain('experiment Tune');
    expect(merged.files['model/resources.lp']).toContain('resource');
    expect(merged.files['model/scenes/Flow.lp']).toContain('process');
    expect(merged.manifest.modelParts).toEqual([
      'model/experiments.lp',
      'model/resources.lp',
      'model/scenes/Flow.lp',
    ]);
  });

  it('sceneContainerFromFile identifies the container of a scene file', () => {
    expect(
      sceneContainerFromFile('model/scenes/Flow.lp', '  process Flow {\n    queue Q { }\n  }\n'),
    ).toEqual({ kind: 'process', name: 'Flow' });
    expect(sceneContainerFromFile('model/main.lp', 'model M {\n}\n')).toBeNull();
    expect(sceneContainerFromFile('model/scenes/Bad.lp', 'not a fragment')).toBeNull();
  });

  it('round-trips the canvas layout (positions, ids and edges survive)', () => {
    const original = buildSample();
    const result = projectToDocument(createProjectBundle(original));
    expect(result.ok).toBe(true);
    const document = result.document!;
    expect(document.name).toBe('MM1');
    expect(document.nodes).toHaveLength(5);
    expect(document.edges).toHaveLength(1);
    expect(document.nodes[0]!.id).toBe(original.nodes[0]!.id);
    expect(document.nodes[1]!.x).toBe(120);
    expect(document.nodes[2]!.y).toBe(200);
    expect(document.nodes[3]!.params).toEqual({ time: 'exponential(1.0)' });
  });

  it('emits the DSL and canvas files under the canonical paths', () => {
    const bundle = createProjectBundle(buildSample());
    expect(bundle.schema).toBe(PROJECT_SCHEMA);
    expect(bundle.manifest.model).toBe('model/main.lp');
    expect(bundle.manifest.presentation).toBe('presentation/main.canvas.json');
    expect(bundle.manifest.defaults.schemaVersion).toBe(2);
    expect(bundle.files['model/main.lp']).toContain('model MM1');
    expect(bundle.files['presentation/main.canvas.json']).toContain('"nodes"');
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
    // parseDsl lays the five blocks out left to right and couples stages.
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
});
