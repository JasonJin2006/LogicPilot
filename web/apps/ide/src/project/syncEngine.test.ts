import { describe, expect, it } from 'vitest';
import { addNode, createDocument } from '@logicpilot/editor';
import { createProject, sceneUid, sceneUidOf } from './project';
import { loadProject, saveProject } from './syncEngine';

describe('project sync engine', () => {
  it('loadProject expands instance references into the canonical document', () => {
    const bundle = createProject('MM1');
    bundle.files['model/main.lp'] =
      'model MM1 {\n  resource Server {\n    capacity = 1\n  }\n' +
      '  instance Worker = "model/scenes/Worker.lp"\n}\n';
    bundle.files['model/scenes/Worker.lp'] =
      '  agent Worker {\n    count = 1\n    queue Q {\n      capacity = 10\n    }\n  }\n';
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(true);
    expect(loaded.diagnostics).toHaveLength(0);
    expect(loaded.document!.nodes.find((node) => node.kind === 'agent')!.name).toBe('Worker');
    expect(loaded.document!.nodes.find((node) => node.name === 'Q')).toBeDefined();
  });

  it('loadProject reports a missing scene as LP3100', () => {
    const bundle = createProject('Broken');
    bundle.files['model/main.lp'] =
      'model Broken {\n  instance Ghost = "model/scenes/Ghost.lp"\n}\n';
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(true); // the placeholder survives
    expect(loaded.diagnostics.some((d) => d.code === 'LP3100')).toBe(true);
  });

  it('loadProject reports structural errors as LP2101', () => {
    const bundle = createProject('Bad');
    bundle.files['model/main.lp'] = 'model Bad {\n  source A {\n}\n';
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.some((d) => d.code === 'LP2101')).toBe(true);
  });

  it('saveProject round-trips without dropping members', () => {
    let document = createDocument('MM1');
    document = addNode(document, { kind: 'resource', name: 'Server', x: 0, y: 0, params: { capacity: 1 } });
    document = addNode(document, { kind: 'agent', name: 'Worker', x: 0, y: 100, params: { count: 1 } });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 200,
      y: 200,
      params: { capacity: 10 },
      container: 'Worker',
    });
    const saved = saveProject(document, createProject('MM1'));
    expect(saved.diagnostics).toHaveLength(0);
    expect(saved.files['model/scenes/Worker.lp']).toContain('agent Worker');
    expect(saved.files['model/main.lp']).toContain('instance Worker');
  });

  it('saveProject keeps hand-authored scene files', () => {
    const document = createDocument('M');
    const current = createProject('M');
    current.files['model/scenes/Extra.lp'] = '  agent Extra {\n    count = 2\n  }\n';
    const saved = saveProject(document, current);
    expect(saved.files['model/scenes/Extra.lp']).toContain('agent Extra');
  });

  it('save then load round-trips the member set', () => {
    let document = createDocument('M');
    document = addNode(document, { kind: 'resource', name: 'R', x: 0, y: 0, params: { capacity: 2 } });
    document = addNode(document, { kind: 'agent', name: 'P', x: 0, y: 100, params: { count: 1 } });
    document = addNode(document, {
      kind: 'sink',
      name: 'Done',
      x: 300,
      y: 200,
      params: {},
      container: 'P',
    });
    const saved = saveProject(document, null);
    const bundle = { ...createProject('M'), files: saved.files };
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(true);
    expect(loaded.diagnostics).toHaveLength(0);
    const keys = (nodes: Array<{ kind: string; name: string }>) =>
      new Set(nodes.map((node) => `${node.kind}:${node.name}`));
    expect(keys(loaded.document!.nodes)).toEqual(keys(document.nodes));
  });

  it('saveProject stamps scene files with a stable uid and records containerIds', () => {
    let document = createDocument('M');
    document = addNode(document, { kind: 'agent', name: 'Worker', x: 0, y: 100, params: { count: 1 } });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 200,
      y: 200,
      params: {},
      container: 'Worker',
    });
    const saved = saveProject(document, null);
    const scenePath = 'model/scenes/Worker.lp';
    const scene = saved.files[scenePath]!;
    expect(scene).toMatch(/^\/\/ @uid lp_[0-9a-f]{16}/);
    expect(sceneUidOf(scene)).toBe(sceneUid(scenePath));
    expect(saved.bundle.manifest.containerIds?.[sceneUid(scenePath)]).toBe(scenePath);
  });

  it('loadProject repairs a scene renamed outside the IDE via its uid', () => {
    const bundle = createProject('M');
    bundle.files['model/main.lp'] =
      'model M {\n  instance Worker = "model/scenes/Worker.lp"\n}\n';
    const oldPath = 'model/scenes/Worker.lp';
    const uid = sceneUid(oldPath);
    bundle.files['model/scenes/Renamed.lp'] = `// @uid ${uid}\n  agent Worker {\n    count = 1\n    queue Q {\n      capacity = 1\n    }\n  }\n`;
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(true);
    expect(loaded.document!.nodes.find((node) => node.kind === 'agent')).toBeDefined();
    expect(loaded.diagnostics.some((d) => d.code === 'LP3102')).toBe(true);
    expect(loaded.diagnostics.some((d) => d.code === 'LP3100')).toBe(false);
  });

  it('loadProject keeps AI-style full grammar (agent/continuous/experiment) intact', () => {
    const bundle = createProject('Swarm');
    bundle.files['model/main.lp'] =
      'model Swarm {\n' +
      '  param seed: int = 7\n' +
      '  agent Drone {\n    count = 3\n    on_tick {\n      flip active\n    }\n  }\n' +
      '  continuous Dynamics {\n    state y: float = 1.0\n    d y/dt = -k*y\n  }\n' +
      '  experiment Tune {\n    budget = 20\n  }\n' +
      '}\n';
    const loaded = loadProject(bundle);
    expect(loaded.ok).toBe(true);
    expect(loaded.diagnostics).toHaveLength(0);
    const kinds = loaded.document!.nodes.map((node) => node.kind);
    expect(kinds).toContain('agent');
    expect(kinds).toContain('on_tick');
    expect(kinds).toContain('continuous');
    expect(kinds).toContain('experiment');
    const agent = loaded.document!.nodes.find((node) => node.kind === 'agent')!;
    expect(agent.params['count']).toBe(3);
    // Saving again keeps the full member set.
    const saved = saveProject(loaded.document!, bundle);
    expect(saved.diagnostics).toHaveLength(0);
    expect(saved.files['model/scenes/Drone.lp']).toContain('agent Drone');
    expect(saved.files['model/scenes/Tune.lp']).toContain('experiment Tune');
  });
});
