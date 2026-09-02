import { describe, expect, it } from 'vitest';
import { normalizeParameters, parseArguments } from '../src/index.js';

describe('OpenAI Agents SDK adapter helpers', () => {
  it('parses only JSON object arguments', () => {
    expect(parseArguments('{"query":"model"}')).toEqual({ query: 'model' });
    expect(parseArguments('[]')).toEqual({});
    expect(parseArguments('bad')).toEqual({});
  });

  it('converts LogicPilot parameter entries to standard JSON Schema', () => {
    expect(
      normalizeParameters({
        query: { type: 'string', required: true },
        limit: { type: 'number' },
      } as never),
    ).toEqual({
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    });
  });
});
