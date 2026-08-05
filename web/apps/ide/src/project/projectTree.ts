// Structural parser + editor for LogicPilot DSL v2 source (the project's
// model/*.lp files). The tree preserves source spans, so edits (add/delete/
// rename) mutate the text in place instead of re-serializing: field and
// behavior content is never touched. Unparseable source is reported with an
// error so the Project panel can show the file as an orphan.

export interface ProjectMember {
  /** The declaration kind token ('resource', 'process', 'source', ...). */
  kind: string;
  /** Block name; empty for leaf lines. */
  name: string;
  /** Referenced scene path for `instance` members. */
  path?: string;
  isLeaf: boolean;
  /** Full member text span in the source. */
  span: { start: number; end: number };
  /** The name token span (rename target); undefined for leaves. */
  nameSpan?: { start: number; end: number };
  /** Offset just after '{' / of the closing '}'; 0 when there is no body. */
  bodyOpen: number;
  bodyClose: number;
  children: ProjectMember[];
}

export interface ProjectModel {
  name: string;
  nameSpan: { start: number; end: number };
  bodyOpen: number;
  bodyClose: number;
  members: ProjectMember[];
}

export interface ProjectParseResult {
  ok: boolean;
  error?: string;
  model?: ProjectModel;
}

export interface MembersParseResult {
  ok: boolean;
  error?: string;
  members?: ProjectMember[];
}

interface Token {
  type: 'word' | 'number' | 'string' | 'punct';
  text: string;
  start: number;
  end: number;
}

function tokenize(source: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i < n) {
    const c = source[i]!;
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      let j = i + 1;
      while (j < n && source[j] !== '"') j++;
      if (j >= n) return 'unterminated string literal';
      tokens.push({ type: 'string', text: source.slice(i + 1, j), start, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (isWordStart(c)) {
      const start = i;
      let j = i;
      while (j < n && isWord(source[j]!)) j++;
      tokens.push({ type: 'word', text: source.slice(start, j), start, end: j });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i;
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(source[j]!)) j++;
      tokens.push({ type: 'number', text: source.slice(start, j), start, end: j });
      i = j;
      continue;
    }
    if ('{}()=,:->.*+/'.includes(c)) {
      let j = i + 1;
      if ((c === '-' || c === '>') && (source[j] === '-' || source[j] === '>')) j++;
      tokens.push({ type: 'punct', text: source.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    return `unexpected character '${c}' at offset ${i}`;
  }
  return tokens;
}

class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
  ) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private isChildBlockStart(): boolean {
    const a = this.tokens[this.pos];
    const b = this.tokens[this.pos + 1];
    const c = this.tokens[this.pos + 2];
    return (
      (a?.type === 'word' &&
        b?.type === 'word' &&
        c?.type === 'punct' &&
        c.text === '{') ||
      // behavior blocks: on_<trigger> { ... } carry no name.
      (a?.type === 'word' &&
        a.text.startsWith('on_') &&
        b?.type === 'punct' &&
        b.text === '{')
    );
  }

  parseModel(): ProjectParseResult {
    const first = this.peek();
    if (first?.type !== 'word' || first.text !== 'model') {
      return { ok: false, error: 'expected a "model" declaration at the start' };
    }
    this.next(); // model
    const name = this.next();
    if (name?.type !== 'word') {
      return { ok: false, error: 'expected a model name' };
    }
    const open = this.next();
    if (open?.type !== 'punct' || open.text !== '{') {
      return { ok: false, error: "expected '{' after the model name" };
    }
    const members = this.parseBody();
    const close = this.next();
    if (close?.type !== 'punct' || close.text !== '}') {
      return { ok: false, error: 'unterminated model body' };
    }
    return {
      ok: true,
      model: {
        name: name.text,
        nameSpan: { start: name.start, end: name.end },
        bodyOpen: open.end,
        bodyClose: close.start,
        members,
      },
    };
  }

  parseBody(): ProjectMember[] {
    const members: ProjectMember[] = [];
    for (;;) {
      const first = this.peek();
      if (first === undefined) break;
      if (first.type === 'punct' && first.text === '}') break;

      // use <library> line.
      if (first.type === 'word' && first.text === 'use') {
        const library = this.tokens[this.pos + 1];
        if (library !== undefined && library.type === 'word') {
          this.pos += 2;
          members.push({
            kind: 'use',
            name: library.text,
            isLeaf: true,
            span: { start: first.start, end: library.end },
            bodyOpen: 0,
            bodyClose: 0,
            children: [],
          });
          continue;
        }
      }

      // instance <name> = "<scene-path>" -> an instanced container node.
      if (first.type === 'word' && first.text === 'instance') {
        const name = this.tokens[this.pos + 1];
        const eq = this.tokens[this.pos + 2];
        const path = this.tokens[this.pos + 3];
        if (
          name?.type === 'word' &&
          eq?.type === 'punct' &&
          eq.text === '=' &&
          path?.type === 'string'
        ) {
          this.pos += 4;
          members.push({
            kind: 'instance',
            name: name.text,
            path: path.text,
            isLeaf: false,
            span: { start: first.start, end: path.end },
            bodyOpen: 0,
            bodyClose: 0,
            children: [],
          });
          continue;
        }
      }

      // kind name { ... } -> nested block.
      if (this.isChildBlockStart()) {
        const kind = this.next()!;
        // Behavior blocks (on_<trigger> { ... }) have no name.
        const name =
          this.peek()?.type === 'word'
            ? this.next()!
            : ({ type: 'word', text: '', start: kind.start, end: kind.start } as Token);
        const open = this.next()!;
        const children = this.parseBody();
        const close = this.next();
        if (close === undefined) {
          members.push({
            kind: kind.text,
            name: name.text,
            isLeaf: false,
            span: { start: kind.start, end: open.end },
            nameSpan: { start: name.start, end: name.end },
            bodyOpen: open.end,
            bodyClose: this.source.length,
            children,
          });
          break;
        }
        members.push({
          kind: kind.text,
          name: name.text,
          isLeaf: false,
          span: { start: kind.start, end: close.end },
          nameSpan: { start: name.start, end: name.end },
          bodyOpen: open.end,
          bodyClose: close.start,
          children,
        });
        continue;
      }

      // Leaf content: consume until a '}' or a nested block at depth 0.
      const start = first.start;
      let depth = 0;
      while (this.pos < this.tokens.length) {
        const current = this.peek()!;
        if (depth === 0 && current.type === 'punct' && current.text === '}') break;
        if (depth === 0 && this.isChildBlockStart()) break;
        if (
          depth === 0 &&
          current.type === 'word' &&
          (current.text === 'instance' || current.text === 'use')
        ) {
          break;
        }
        this.next();
        if (current.type === 'punct' && current.text === '{') depth++;
        if (current.type === 'punct' && current.text === '}') depth--;
      }
      const last = this.tokens[this.pos - 1];
      if (last === undefined) break;
      members.push({
        kind: 'leaf',
        name: '',
        isLeaf: true,
        span: { start, end: last.end },
        bodyOpen: 0,
        bodyClose: 0,
        children: [],
      });
    }
    return members;
  }
}

/** Parse DSL source into a structural tree. */
export function parseProjectSource(source: string): ProjectParseResult {
  const tokens = tokenize(source);
  if (typeof tokens === 'string') {
    return { ok: false, error: tokens };
  }
  return new Parser(source, tokens).parseModel();
}

/** Parse a fragment (member declarations without the `model` wrapper), as
 *  used by the per-concern model part files (model/resources.lp, ...). */
export function parseProjectMembers(source: string): MembersParseResult {
  const tokens = tokenize(source);
  if (typeof tokens === 'string') {
    return { ok: false, error: tokens };
  }
  const parser = new Parser(source, tokens);
  const members = parser.parseBody();
  if (parser.peek() !== undefined) {
    return { ok: false, error: 'unexpected content after members' };
  }
  return { ok: true, members };
}

// --- edit operations (in-place text mutation) -------------------------------

/** Insert a serialized block before the closing brace of a container body. */
export function insertMember(
  source: string,
  bodyClose: number,
  indent: string,
  blockText: string,
): string {
  const indented = blockText.replace(/^/gm, indent);
  const before = source.slice(0, bodyClose);
  const after = source.slice(bodyClose);
  // Separate the inserted block from the container's closing brace: without
  // a trailing newline the block's '}' would collide with the container's
  // '}' (and later line-based deletes would overshoot to the end of file).
  const sep = before.endsWith('\n') ? '' : '\n';
  return `${before}${sep}${indented}\n${after}`;
}

/** Remove the whole line range covering [start, end), including its newline. */
export function deleteSpan(source: string, start: number, end: number): string {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const newline = source.indexOf('\n', end);
  const lineEnd = newline === -1 ? source.length : newline + 1;
  return source.slice(0, lineStart) + source.slice(lineEnd);
}

/** Replace the token range [start, end) with newText. */
export function replaceSpan(source: string, start: number, end: number, newText: string): string {
  return `${source.slice(0, start)}${newText}${source.slice(end)}`;
}

// --- default block templates for the Project panel's "add" actions ----------

export const MODEL_ADD_KINDS: Array<{ kind: string; template: (name: string) => string }> = [
  { kind: 'param', template: (n) => `param ${n}: float = 0.0` },
  { kind: 'resource', template: (n) => `resource ${n} {\n  capacity = 1\n}` },
  { kind: 'agent', template: (n) => `agent ${n} {\n  count = 1\n}` },
  {
    kind: 'atomic',
    template: (n) => `atomic ${n} {\n  state phase: int = 0\n  time_advance = constant(1.0)\n}`,
  },
  { kind: 'continuous', template: (n) => `continuous ${n} {\n  state y: float = 1.0\n  d y/dt = -y\n}` },
  {
    kind: 'experiment',
    template: (n) => `experiment ${n} {\n  objective = minimize Wq\n  budget = 20\n}`,
  },
];
