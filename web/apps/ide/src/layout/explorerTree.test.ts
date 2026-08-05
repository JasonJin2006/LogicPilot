import { describe, expect, it } from 'vitest';
import { isFolder, treeFromPaths } from './ExplorerPanel';

describe('explorer tree', () => {
  it('keeps root-level files as rows, not folders', () => {
    const tree = treeFromPaths([
      'logicpilot.json',
      'model/main.lp',
      'model/resources.lp',
      'presentation/main.canvas.json',
    ]);
    const walk = (entries: unknown[]): void => {
      for (const entry of entries) {
        const candidate = entry as { children?: unknown[]; name: string };
        if (isFolder(entry as never)) {
          expect(Array.isArray(candidate.children)).toBe(true);
          walk(candidate.children ?? []);
        }
      }
    };
    walk(tree);
    // The root file stays a file (rendered by FileRow, never FolderRow) even
    // though folders sort before files.
    const rootFile = tree.find((entry) => entry.name === 'logicpilot.json')!;
    expect(isFolder(rootFile as never)).toBe(false);
    expect(tree.some((entry) => isFolder(entry as never) && entry.name === 'model')).toBe(true);
  });
});
