import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OUTLINE_CONTRIBUTIONS, type OutlineContribution } from './outline';

function contribution(partial: Partial<OutlineContribution> & { id: string }): OutlineContribution {
  return {
    priority: 0,
    applies: () => true,
    component: () => <div data-testid={`outline-${partial.id}`} />,
    ...partial,
  } as OutlineContribution;
}

describe('outline registry', () => {
  it('rejects duplicate ids', () => {
    const dispose = OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.dup' }));
    expect(() => OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.dup' }))).toThrow();
    dispose();
  });

  it('resolves by priority, then registration order', () => {
    const low = OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.low' }));
    const high = OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.high', priority: 10 }));
    const context = { activePath: null, activeDocumentType: null, hasProject: true };
    expect(OUTLINE_CONTRIBUTIONS.resolve(context)?.id).toBe('test.high');
    // The lower-priority contribution applies when the higher one defers.
    high();
    expect(OUTLINE_CONTRIBUTIONS.resolve(context)?.id).toBe('test.low');
    low();
    expect(OUTLINE_CONTRIBUTIONS.resolve(context)).toBeNull();
  });

  it('skips contributions that do not apply', () => {
    const scoped = OUTLINE_CONTRIBUTIONS.register(
      contribution({
        id: 'test.scoped',
        priority: 10,
        applies: ({ activeDocumentType }) => activeDocumentType === 'testlang',
      }),
    );
    const plain = OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.plain' }));
    const sysml = { activePath: 'm.testlang', activeDocumentType: 'testlang', hasProject: true };
    expect(OUTLINE_CONTRIBUTIONS.resolve(sysml)?.id).toBe('test.scoped');
    expect(OUTLINE_CONTRIBUTIONS.resolve({ ...sysml, activeDocumentType: null })?.id).toBe(
      'test.plain',
    );
    scoped();
    plain();
  });

  it('mounts the resolved contribution component', () => {
    const mounted = OUTLINE_CONTRIBUTIONS.register(contribution({ id: 'test.mount' }));
    const Outline = OUTLINE_CONTRIBUTIONS.resolve({
      activePath: null,
      activeDocumentType: null,
      hasProject: true,
    })!;
    expect(renderToStaticMarkup(<Outline.component />)).toContain('outline-test.mount');
    mounted();
  });
});
