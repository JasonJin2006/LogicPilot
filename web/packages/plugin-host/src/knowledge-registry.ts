import type { KnowledgeBlock, KnowledgeBlockType, KnowledgeStatus } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface KnowledgeQuery {
  readonly paradigm?: string;
  readonly domain?: string;
  readonly types?: readonly KnowledgeBlockType[];
  readonly statuses?: readonly KnowledgeStatus[];
  readonly limit?: number;
}

/** Generation-aware structured knowledge index. Natural-language localization
 * is retained on a block only as display text; query selection uses scope,
 * type and verification status. */
export class KnowledgeRegistry {
  private generationValue = 0;
  private blocks = new Map<string, KnowledgeBlock>();

  generation(): number {
    return this.generationValue;
  }

  prepare(blocks: readonly unknown[]): {
    readonly generation: number;
    readonly blocks: readonly KnowledgeBlock[];
  } {
    const next: KnowledgeBlock[] = [];
    const ids = new Set<string>();
    for (const raw of blocks) {
      const validated = validateContract('KnowledgeBlock', raw);
      if (!validated.ok) throw new Error(`invalid knowledge block: ${validated.errors.join('; ')}`);
      if (ids.has(validated.value.id))
        throw new Error(`duplicate knowledge block '${validated.value.id}'`);
      ids.add(validated.value.id);
      next.push(validated.value);
    }
    return { generation: this.generationValue + 1, blocks: next };
  }

  commit(prepared: {
    readonly generation: number;
    readonly blocks: readonly KnowledgeBlock[];
  }): void {
    if (prepared.generation !== this.generationValue + 1)
      throw new Error('stale knowledge generation');
    this.blocks = new Map(prepared.blocks.map((block) => [block.id, block]));
    this.generationValue = prepared.generation;
  }

  query(query: KnowledgeQuery = {}): readonly KnowledgeBlock[] {
    const statuses = new Set(query.statuses ?? ['trusted']);
    const types = query.types ? new Set(query.types) : null;
    const result = [...this.blocks.values()].filter((block) => {
      if (!statuses.has(block.status)) return false;
      if (types && !types.has(block.type)) return false;
      if (query.paradigm && !(block.scope?.paradigms ?? []).includes(query.paradigm)) return false;
      if (query.domain && !(block.scope?.domains ?? []).includes(query.domain)) return false;
      return true;
    });
    const limit = query.limit ?? result.length;
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error('knowledge query limit must be non-negative');
    return result.slice(0, limit);
  }
}
