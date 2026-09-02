import { describe, expect, it } from 'vitest';
import { KnowledgeRegistry } from '../src/index.js';

function block(id: string, status: 'draft' | 'trusted' = 'trusted') {
  return {
    schema: 'logicpilot.knowledge-block/v1',
    contractVersion: 1,
    id,
    version: '1.0.0',
    owner: 'logicpilot.knowledge',
    type: 'concept',
    classification: 'plugin',
    status,
    scope: { paradigms: ['process'], domains: ['queueing'] },
    provenance: { source: 'doi:10.0000/example', locator: '§1', confidence: 0.9 },
    content: { definition: 'structured definition' },
  };
}

describe('KnowledgeRegistry', () => {
  it('indexes only validated blocks and defaults context queries to trusted', () => {
    const registry = new KnowledgeRegistry();
    registry.commit(registry.prepare([block('kb.trusted'), block('kb.draft', 'draft')]));
    expect(
      registry.query({ paradigm: 'process', domain: 'queueing' }).map((item) => item.id),
    ).toEqual(['kb.trusted']);
    expect(registry.query({ statuses: ['draft'] }).map((item) => item.id)).toEqual(['kb.draft']);
  });

  it('rejects duplicates and stale commits', () => {
    const registry = new KnowledgeRegistry();
    expect(() => registry.prepare([block('kb.same'), block('kb.same')])).toThrow(/duplicate/);
    const prepared = registry.prepare([block('kb.one')]);
    registry.commit(prepared);
    expect(() => registry.commit(prepared)).toThrow(/stale/);
  });
});
