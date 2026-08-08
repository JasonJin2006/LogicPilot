import { addNode, connect, createDocument, generateDsl } from '@logicpilot/editor';
import { describe, expect, it } from 'vitest';

import { createModelProposal } from './modelProposal';
import { createPatchProposal } from './modelProposal';

describe('AI model proposal', () => {
  it('previews a one-field edit without destructive graph operations', () => {
    let current = addNode(createDocument('Line'), {
      kind: 'source',
      name: 'In',
      x: 20,
      y: 40,
      params: { arrival: 'rate(1)' },
    });
    current = addNode(current, { kind: 'sink', name: 'Out', x: 240, y: 40 });
    current = connect(current, current.nodes[0]!.id, current.nodes[1]!.id).document;

    const candidate = generateDsl({
      ...current,
      nodes: current.nodes.map((node) =>
        node.name === 'In' ? { ...node, params: { arrival: 'rate(2)' } } : node,
      ),
    });
    const proposal = createModelProposal(current, candidate);
    expect(proposal.ok).toBe(true);
    expect(proposal.destructiveOperations).toBe(0);
    expect(proposal.patch?.operations).toHaveLength(1);
    expect(proposal.descriptions[0]).toContain('arrival');
  });

  it('labels removals so the UI can require an explicit review', () => {
    const current = addNode(createDocument('Line'), {
      kind: 'source',
      name: 'In',
      x: 0,
      y: 0,
    });
    const proposal = createModelProposal(current, 'model Line { use process sink Done { } }');
    expect(proposal.ok).toBe(true);
    expect(proposal.destructiveOperations).toBeGreaterThan(0);
    expect(proposal.descriptions.some((line) => line.startsWith('Remove block'))).toBe(true);
  });

  it('rejects a candidate the editor cannot parse', () => {
    const proposal = createModelProposal(createDocument(), 'this is not DSL');
    expect(proposal.ok).toBe(false);
    expect(proposal.patch).toBeNull();
  });

  it('validates a native structural patch without mutating the inspected model', () => {
    const current = addNode(createDocument('Line'), {
      kind: 'source',
      name: 'In',
      x: 0,
      y: 0,
    });
    const proposal = createPatchProposal(current, {
      version: 1,
      operations: [
        { op: 'add_block', kind: 'sink', name: 'Done' },
        { op: 'connect', from: current.nodes[0]!.id, to: 'Done' },
      ],
    });
    expect(proposal.ok).toBe(true);
    expect(current.nodes).toHaveLength(1);
    expect(proposal.candidateDocument?.nodes).toHaveLength(2);
    expect(proposal.candidateDocument?.edges).toHaveLength(1);
  });
});
