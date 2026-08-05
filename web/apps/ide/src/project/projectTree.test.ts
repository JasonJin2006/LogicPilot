import { describe, expect, it } from 'vitest';
import {
  deleteSpan,
  insertMember,
  parseProjectSource,
  replaceSpan,
} from './projectTree';

const MM1 = `model MM1 {
  use process
  param arrival_rate: float = 0.8

  resource Server {
    capacity = 1
  }

  agent Worker {
    source Arrivals {
      arrival = rate(arrival_rate)
    }
    queue WaitLine {
      capacity = 1000000
    }
    couple Arrivals.out -> WaitLine.in
  }

  experiment Tune {
    objective = minimize Wq
    budget = 20
  }
}
`;

describe('projectTree', () => {
  it('parses model members and nested blocks', () => {
    const result = parseProjectSource(MM1);
    expect(result.ok).toBe(true);
    const model = result.model!;
    expect(model.name).toBe('MM1');
    const kinds = model.members.map((member) => member.kind);
    expect(kinds).toEqual(['use', 'leaf', 'resource', 'agent', 'experiment']);

    const resource = model.members.find((member) => member.kind === 'resource')!;
    expect(resource.name).toBe('Server');
    expect(resource.isLeaf).toBe(false);

    const agent = model.members.find((member) => member.kind === 'agent')!;
    expect(agent.children.map((child) => child.kind)).toEqual(['source', 'queue', 'leaf']);
    expect(agent.children[0]!.name).toBe('Arrivals');

    const experiment = model.members.find((member) => member.kind === 'experiment')!;
    expect(experiment.name).toBe('Tune');
  });

  it('reports unparseable source with an error', () => {
    expect(parseProjectSource('not a model {').ok).toBe(false);
    expect(parseProjectSource('model X { resource {').ok).toBe(false);
    expect(parseProjectSource('').ok).toBe(false);
  });

  it('insertMember adds a block that re-parses', () => {
    const result = parseProjectSource(MM1);
    const model = result.model!;
    const next = insertMember(
      MM1,
      model.bodyClose,
      '  ',
      'resource Backup {\n  capacity = 2\n}',
    );
    const reparsed = parseProjectSource(next);
    expect(reparsed.ok).toBe(true);
    const kinds = reparsed.model!.members.map((member) => member.kind);
    expect(kinds).toContain('resource');
    expect(reparsed.model!.members.find((m) => m.kind === 'resource' && m.name === 'Backup')).toBeDefined();
    // Original content is untouched.
    expect(next).toContain('param arrival_rate: float = 0.8');
    expect(next).toContain('objective = minimize Wq');
  });

  it('deleteSpan removes a member line range', () => {
    const result = parseProjectSource(MM1);
    const agent = result.model!.members.find((member) => member.kind === 'agent')!;
    const queue = agent.children.find((child) => child.kind === 'queue')!;
    const next = deleteSpan(MM1, queue.span.start, queue.span.end);
    const reparsed = parseProjectSource(next);
    expect(reparsed.ok).toBe(true);
    const agentAgain = reparsed.model!.members.find((m) => m.kind === 'agent')!;
    expect(agentAgain.children.map((c) => c.kind)).toEqual(['source', 'leaf']);
    expect(next).not.toContain('queue WaitLine');
  });

  it('replaceSpan renames a block', () => {
    const result = parseProjectSource(MM1);
    const resource = result.model!.members.find((m) => m.kind === 'resource')!;
    const next = replaceSpan(MM1, resource.nameSpan!.start, resource.nameSpan!.end, 'Primary');
    const reparsed = parseProjectSource(next);
    const renamed = reparsed.model!.members.find((m) => m.kind === 'resource')!;
    expect(renamed.name).toBe('Primary');
  });

  it('add/delete round trip keeps the source valid', () => {
    const canvasDsl =
      'model SyncCheck {\n' +
      '  resource resource {\n' +
      '    capacity = 1\n' +
      '  }\n' +
      '  agent Worker {\n' +
      '    queue queue {\n' +
      '      capacity = 100\n' +
      '    }\n' +
      '  }\n' +
      '}\n';
    let source = canvasDsl;
    let parsed = parseProjectSource(source);
    expect(parsed.ok).toBe(true);

    source = insertMember(
      source,
      parsed.model!.bodyClose,
      '  ',
      'experiment Experiment1 {\n  objective = minimize Wq\n  budget = 20\n}',
    );
    parsed = parseProjectSource(source);
    expect(parsed.ok).toBe(true);

    const agent = parsed.model!.members.find((m) => m.kind === 'agent')!;
    source = insertMember(
      source,
      agent.bodyClose,
      '    ',
      'queue Queue2 {\n  capacity = 100\n}',
    );
    parsed = parseProjectSource(source);
    expect(parsed.ok).toBe(true);

    const experiment = parsed.model!.members.find((m) => m.kind === 'experiment')!;
    source = deleteSpan(source, experiment.span.start, experiment.span.end);
    const final = parseProjectSource(source);
    expect(final.ok).toBe(true);
    expect(final.model!.members.map((m) => m.kind)).toEqual([
      'resource',
      'agent',
    ]);
  });
});
