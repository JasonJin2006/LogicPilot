import { describe, expect, it, vi } from 'vitest';
import { bindPanelCommands, requestOpenPanel } from './panelCommands';

describe('panel commands', () => {
  it('routes requests to the bound layout and clears only the active binding', () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = bindPanelCommands(first);
    const disposeSecond = bindPanelCommands(second);

    disposeFirst();
    expect(requestOpenPanel('center', 'model')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('center', 'model');

    disposeSecond();
    expect(requestOpenPanel('bottom', 'problems')).toBe(false);
  });
});
