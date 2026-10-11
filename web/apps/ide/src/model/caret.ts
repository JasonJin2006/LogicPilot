// Caret math for the text editor: turn a textarea offset into the 1-based
// line/column the status bar reports (VS Code's "Ln 12, Col 4").
//
// Kept out of the component so it is a pure function: the editor publishes
// the result, it does not interpret it.

/** 1-based line and column of `offset` inside `value`. An offset past the
 *  end clamps to the last position rather than throwing - a textarea can
 *  report a stale selectionStart for one frame after a programmatic edit. */
export function caretPosition(value: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, value.length));
  const before = value.slice(0, clamped);
  const lineBreak = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: clamped - (lineBreak + 1) + 1,
  };
}
