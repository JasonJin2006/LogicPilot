import { describe, expect, it } from 'vitest';

import {
  addNode,
  applyModelPatch,
  connect,
  createDocument,
  diffModelDocuments,
  generateDsl,
  type ModelPatch,
} from '../src/index.js';

describe('ModelPatch', () => {
  it('builds and modifies a DES flow by stable block names', () => {
    const patch: ModelPatch = {
      version: 1,
      operations: [
        { op: 'rename_model', name: 'Clinic' },
        { op: 'add_block', kind: 'source', name: 'Patients', params: { arrival: 'rate(2)' } },
        { op: 'add_block', kind: 'queue', name: 'Waiting', params: { capacity: 50 } },
        {
          op: 'add_block',
          kind: 'service',
          name: 'Treatment',
          params: { time: 'constant(4)', queueCapacity: 10 },
        },
        { op: 'add_block', kind: 'sink', name: 'Done' },
        { op: 'connect', from: 'Patients', to: 'Waiting' },
        { op: 'connect', from: 'Waiting', to: 'Treatment' },
        { op: 'connect', from: 'Treatment', to: 'Done' },
        { op: 'update_block', target: 'Waiting', params: { capacity: 80 } },
      ],
    };
    const result = applyModelPatch(createDocument(), patch);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(9);
    expect(result.document.edges).toHaveLength(3);
    expect(result.document.nodes.find((node) => node.name === 'Waiting')?.params.capacity).toBe(80);
    expect(generateDsl(result.document)).toContain('couple Waiting.out -> Treatment.in');
  });

  it('is atomic when a generated operation is invalid', () => {
    const original = createDocument('Original');
    const result = applyModelPatch(original, {
      version: 1,
      operations: [
        { op: 'add_block', kind: 'source', name: 'A' },
        { op: 'connect', from: 'A', to: 'Missing' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.document).toBe(original);
    expect(result.diagnostics[0]?.code).toBe('MP2001');
  });

  it('disconnects and removes blocks without leaving dangling edges', () => {
    const built = applyModelPatch(createDocument(), {
      version: 1,
      operations: [
        { op: 'add_block', kind: 'source', name: 'A' },
        { op: 'add_block', kind: 'sink', name: 'B' },
        { op: 'connect', from: 'A', to: 'B' },
      ],
    });
    expect(built.ok).toBe(true);
    const removed = applyModelPatch(built.document, {
      version: 1,
      operations: [{ op: 'remove_block', target: 'B' }],
    });
    expect(removed.ok).toBe(true);
    expect(removed.document.nodes).toHaveLength(1);
    expect(removed.document.edges).toHaveLength(0);
  });

  it('splices a new block into an existing coupling (insertion intent)', () => {
    let doc = createDocument();
    doc = addNode(doc, { kind: 'source', name: 'S', x: 0, y: 0 });
    doc = addNode(doc, { kind: 'queue', name: 'Q', x: 200, y: 0 });
    doc = connect(doc, doc.nodes[0]!.id, doc.nodes[1]!.id).document;
    const edgeId = doc.edges[0]!.id;

    const result = applyModelPatch(doc, {
      version: 1,
      operations: [
        { op: 'disconnect', edge: edgeId },
        { op: 'add_block', kind: 'delay', name: 'Buffer' },
        { op: 'connect', from: 'S', to: 'Buffer' },
        { op: 'connect', from: 'Buffer', to: 'Q' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.document.nodes.map((node) => node.name)).toEqual(['S', 'Q', 'Buffer']);
    expect(result.document.edges).toHaveLength(2);
    expect(result.document.edges[0]!.to).toBe(
      result.document.nodes.find((n) => n.name === 'Buffer')!.id,
    );
    expect(result.document.edges[1]!.from).toBe(
      result.document.nodes.find((n) => n.name === 'Buffer')!.id,
    );
  });

  it('replaces a block kind while preserving the flow topology', () => {
    let doc = createDocument();
    for (const [kind, name, x] of [
      ['source', 'S', 0],
      ['queue', 'Q', 200],
      ['sink', 'K', 400],
    ] as const) {
      doc = addNode(doc, { kind, name, x, y: 0 });
    }
    doc = connect(doc, doc.nodes[0]!.id, doc.nodes[1]!.id).document;
    doc = connect(doc, doc.nodes[1]!.id, doc.nodes[2]!.id).document;

    const result = applyModelPatch(doc, {
      version: 1,
      operations: [
        { op: 'remove_block', target: 'Q' },
        { op: 'add_block', kind: 'delay', name: 'Q' },
        { op: 'connect', from: 'S', to: 'Q' },
        { op: 'connect', from: 'Q', to: 'K' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.nodes.find((node) => node.name === 'Q')?.kind).toBe('delay');
    expect(result.document.edges).toHaveLength(2);
    expect(generateDsl(result.document)).toContain('couple S.out -> Q.in');
    expect(generateDsl(result.document)).toContain('couple Q.out -> K.in');
  });

  it('diffs a generated model while preserving matching node ids and positions', () => {
    let current = addNode(createDocument('Old'), {
      kind: 'source',
      name: 'In',
      x: 900,
      y: 700,
      params: { arrival: 'rate(1)', obsolete: true },
    });
    current = addNode(current, { kind: 'sink', name: 'OldSink', x: 1000, y: 700 });
    current = connect(current, current.nodes[0]!.id, current.nodes[1]!.id).document;
    let desired = addNode(createDocument('New'), {
      kind: 'source',
      name: 'In',
      x: 0,
      y: 0,
      params: { arrival: 'rate(2)' },
    });
    desired = addNode(desired, { kind: 'sink', name: 'Done', x: 300, y: 0 });
    desired = connect(desired, desired.nodes[0]!.id, desired.nodes[1]!.id).document;

    const result = applyModelPatch(current, diffModelDocuments(current, desired));
    expect(result.ok).toBe(true);
    const preserved = result.document.nodes.find((node) => node.name === 'In')!;
    expect(preserved.id).toBe(current.nodes[0]!.id);
    expect([preserved.x, preserved.y]).toEqual([900, 700]);
    expect(preserved.params).toEqual({ arrival: 'rate(2)' });
    expect(result.document.nodes.some((node) => node.name === 'OldSink')).toBe(false);
    expect(result.document.edges).toHaveLength(1);
  });

  it('creates a minimal parameter patch without rebuilding unchanged couplings', () => {
    let current = addNode(createDocument('Line'), {
      kind: 'source',
      name: 'In',
      x: 10,
      y: 20,
      params: { arrival: 'rate(1)' },
    });
    current = addNode(current, { kind: 'sink', name: 'Out', x: 200, y: 20 });
    current = connect(current, current.nodes[0]!.id, current.nodes[1]!.id).document;
    const originalEdgeId = current.edges[0]!.id;

    let desired = addNode(createDocument('Line'), {
      kind: 'source',
      name: 'In',
      x: 0,
      y: 0,
      params: { arrival: 'rate(2)' },
    });
    desired = addNode(desired, { kind: 'sink', name: 'Out', x: 300, y: 0 });
    desired = connect(desired, desired.nodes[0]!.id, desired.nodes[1]!.id).document;

    const patch = diffModelDocuments(current, desired);
    expect(patch.operations).toEqual([
      {
        op: 'update_block',
        target: current.nodes[0]!.id,
        params: { arrival: 'rate(2)' },
        removeParams: [],
      },
    ]);
    const result = applyModelPatch(current, patch);
    expect(result.ok).toBe(true);
    expect(result.document.edges[0]!.id).toBe(originalEdgeId);
  });
});
