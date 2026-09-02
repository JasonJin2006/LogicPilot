import { describe, expect, it } from 'vitest';
import { compilePluginContext } from './contextCompiler';
import type { PluginRegistrySnapshot } from '../plugins/registry';

function snapshot(): PluginRegistrySnapshot {
  return {
    generation: 7,
    plugins: ['logicpilot.a', 'logicpilot.b'],
    contributions: [
      {
        schema: 'logicpilot.plugin-contributions/v1',
        contractVersion: 1,
        pluginId: 'logicpilot.b',
        version: '1.0.0',
        knowledge: [
          {
            schema: 'logicpilot.knowledge-block/v1',
            contractVersion: 1,
            id: 'kb.draft',
            version: '1.0.0',
            owner: 'logicpilot.b',
            type: 'concept',
            classification: 'plugin',
            status: 'draft',
            content: { text: 'must not enter context' },
            provenance: { source: 'test' },
          },
          {
            schema: 'logicpilot.knowledge-block/v1',
            contractVersion: 1,
            id: 'kb.trusted',
            version: '1.0.0',
            owner: 'logicpilot.b',
            type: 'constraint',
            classification: 'plugin',
            status: 'trusted',
            scope: { paradigms: ['process'] },
            content: { predicate: 'queue.capacity > 0' },
            provenance: { source: 'test' },
          },
        ],
        skills: [
          {
            id: 'skill.review',
            name: 'Review',
            trigger: 'review model',
            inputs: [],
            steps: [{ id: 'inspect_model', action: 'inspect' }],
            permissions: [],
          },
        ],
        instructions: [
          { id: 'instruction.low', scope: 'process', priority: 1, rules: ['low'], forbidden: [] },
          { id: 'instruction.high', scope: '*', priority: 10, rules: ['high'], forbidden: [] },
        ],
        diagnostics: [
          {
            schema: 'logicpilot.diagnostic-definition/v1',
            contractVersion: 1,
            id: 'LP0001',
            pluginId: 'logicpilot.b',
            titleKey: 'diagnostic.lp0001',
            defaultSeverity: 'warning',
            fixIds: [],
            appliesToParadigms: ['process'],
          },
        ],
        views: [],
        notations: [],
        createActions: [],
        palettes: [],
        tools: [],
      },
    ],
  };
}

describe('structured plugin context compiler', () => {
  it('selects trusted, applicable blocks and orders instructions deterministically', () => {
    const compiled = compilePluginContext(snapshot(), {
      documentType: 'process',
      paradigm: 'process',
    });
    expect(compiled.generation).toBe(7);
    expect(JSON.parse(compiled.knowledge!)).toEqual([
      expect.objectContaining({ id: 'kb.trusted' }),
    ]);
    expect(JSON.parse(compiled.instructions!)).toEqual([
      expect.objectContaining({ id: 'instruction.high' }),
      expect.objectContaining({ id: 'instruction.low' }),
    ]);
    expect(JSON.parse(compiled.skills!)[0].id).toBe('skill.review');
    expect(JSON.parse(compiled.diagnosticDefinitions!)[0].id).toBe('LP0001');
  });

  it('never emits a partial JSON string when applying a size bound', () => {
    const compiled = compilePluginContext(snapshot(), {}, 256);
    for (const value of [
      compiled.knowledge,
      compiled.skills,
      compiled.instructions,
      compiled.diagnosticDefinitions,
    ]) {
      if (value !== undefined) expect(() => JSON.parse(value)).not.toThrow();
    }
  });
});
