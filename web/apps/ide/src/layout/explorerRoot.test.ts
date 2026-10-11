import { describe, expect, it } from 'vitest';
import { explorerRootKind } from './ExplorerPanel';

// The Explorer root row has three genuinely different meanings, and only two of
// them can be expanded. Getting this wrong is not cosmetic: a document root
// drawn as a folder looks like a folder that refuses to open, which is exactly
// how it was reported ("only a folder is shown, no files").
describe('explorer root kind', () => {
  it('reports a browsable folder for an on-disk project', () => {
    expect(explorerRootKind({ isDisk: true, hasBundle: true })).toBe('folder');
  });

  it('reports a bundle for an in-memory project', () => {
    // A .lpproj opened as a file: not a directory, but it does carry a file
    // table, so it expands and a folder-ish glyph is honest.
    expect(explorerRootKind({ isDisk: false, hasBundle: true })).toBe('bundle');
  });

  it('reports a document when there is no file table at all', () => {
    // A bare .lp/.sysml opened as a virtual workspace: no bundle, no disk
    // files, no children. This is the case that must not look expandable.
    expect(explorerRootKind({ isDisk: false, hasBundle: false })).toBe('document');
  });

  it('treats a disk project as a folder even before its bundle loads', () => {
    // The folder is a folder regardless of whether the bundle has been read
    // yet; the previous bundle-only test drew it as a closed folder icon.
    expect(explorerRootKind({ isDisk: true, hasBundle: false })).toBe('folder');
  });
});
