import { describe, expect, it } from 'vitest';
import { breadcrumbCrumbs } from './BreadcrumbBar';

describe('editor breadcrumb', () => {
  it('builds project, path and focused symbol in order', () => {
    expect(breadcrumbCrumbs('call-center', 'models/main.lp', 'MM1')).toEqual([
      'call-center',
      'models',
      'main.lp',
      'MM1',
    ]);
  });

  it('omits missing parts instead of emitting empty crumbs', () => {
    expect(breadcrumbCrumbs(null, null, null)).toEqual([]);
    expect(breadcrumbCrumbs('', '', '')).toEqual([]);
    expect(breadcrumbCrumbs(null, 'main.lp', null)).toEqual(['main.lp']);
    expect(breadcrumbCrumbs('call-center', null, 'Handle')).toEqual(['call-center', 'Handle']);
  });

  it('ignores empty path segments', () => {
    expect(breadcrumbCrumbs(null, '/models//main.lp', null)).toEqual(['models', 'main.lp']);
  });

  it('collapses a long path to root, ellipsis and the last two segments', () => {
    expect(breadcrumbCrumbs(null, 'a/b/c/d/e.lp', null)).toEqual(['a', '…', 'd', 'e.lp']);
    // Four segments stay intact - the clamp only kicks in past it.
    expect(breadcrumbCrumbs(null, 'a/b/c/d.lp', null)).toEqual(['a', 'b', 'c', 'd.lp']);
  });
});
