// Vector path command helpers: parse SVG path commands (M/L/C/Q/S/T/Z) into
// editable point lists, move points and delete points. Path commands are
// stored in the node's LOCAL coordinate space (relative to transform.x/y);
// the renderer draws them inside a group translated to the node position.

export interface PathCommand {
  command: string;
  args: number[];
}

export function parsePathCommands(commands: string[]): PathCommand[] {
  const parsed: PathCommand[] = [];
  for (const raw of commands) {
    const match = /^([A-Za-z])\s*([\s\S]*)$/.exec(raw.trim());
    if (!match) {
      continue;
    }
    const args = (match[2]!.match(/-?[0-9.]+/g) ?? []).map(Number);
    parsed.push({ command: match[1]!, args });
  }
  return parsed;
}

export interface PathPoint {
  commandIndex: number;
  argIndex: number;
  x: number;
  y: number;
}

/** Every coordinate pair in the path (Z excluded) as an editable point. */
export function pathPointList(commands: string[]): PathPoint[] {
  const points: PathPoint[] = [];
  parsePathCommands(commands).forEach((cmd, commandIndex) => {
    if (cmd.command.toLowerCase() === 'z') {
      return;
    }
    for (let argIndex = 0; argIndex + 1 < cmd.args.length; argIndex += 2) {
      points.push({
        commandIndex,
        argIndex,
        x: cmd.args[argIndex]!,
        y: cmd.args[argIndex + 1]!,
      });
    }
  });
  return points;
}

/** Move one path point (the coordinate pair at `point`). */
export function updatePathPoint(
  commands: string[],
  point: PathPoint,
  x: number,
  y: number,
): string[] {
  return commands.map((raw, index) => {
    if (index !== point.commandIndex) {
      return raw;
    }
    const cmd = parsePathCommands([raw])[0];
    if (!cmd) {
      return raw;
    }
    const args = [...cmd.args];
    if (point.argIndex + 1 >= args.length) {
      return raw;
    }
    args[point.argIndex] = x;
    args[point.argIndex + 1] = y;
    return `${cmd.command} ${args.join(' ')}`;
  });
}

/** Delete a path point by dropping its command. The first `M` is kept as
 *  the path anchor and cannot be deleted. */
export function removePathPoint(commands: string[], point: PathPoint): string[] {
  if (point.commandIndex === 0) {
    return commands;
  }
  return commands.filter((_, index) => index !== point.commandIndex);
}
