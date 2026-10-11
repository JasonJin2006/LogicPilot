import { describe, expect, it } from 'vitest';
import { caretPosition } from './caret';

const SOURCE = 'model M {\n  param rate\n}\n';

describe('caretPosition', () => {
  it('reports the first position of an empty buffer as 1:1', () => {
    expect(caretPosition('', 0)).toEqual({ line: 1, column: 1 });
  });

  it('counts lines and columns 1-based', () => {
    // Offset 0 is the `m` of line 1; offset 2 is the `d`.
    expect(caretPosition(SOURCE, 0)).toEqual({ line: 1, column: 1 });
    expect(caretPosition(SOURCE, 2)).toEqual({ line: 1, column: 3 });
  });

  it('starts column 1 immediately after a line break', () => {
    const afterFirstLine = SOURCE.indexOf('\n') + 1;
    expect(caretPosition(SOURCE, afterFirstLine)).toEqual({ line: 2, column: 1 });
  });

  it('treats a caret sitting on a line break as the end of that line', () => {
    const atBreak = SOURCE.indexOf('\n');
    expect(caretPosition(SOURCE, atBreak)).toEqual({ line: 1, column: 10 });
  });

  it('handles the end of the buffer and an over-long offset', () => {
    const end = caretPosition(SOURCE, SOURCE.length);
    expect(end).toEqual({ line: 4, column: 1 });
    // A stale offset clamps instead of running off the end.
    expect(caretPosition(SOURCE, SOURCE.length + 40)).toEqual(end);
    expect(caretPosition(SOURCE, -5)).toEqual({ line: 1, column: 1 });
  });
});
