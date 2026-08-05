import { describe, expect, it } from 'vitest';
import { addNode, connect, createDocument } from '@logicpilot/editor';
import type { ModelDocument } from '@logicpilot/editor';
import {
  PROJECT_SCHEMA,
  bundleToJson,
  createProjectBundle,
  parseProjectBundle,
  projectToDocument,
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
