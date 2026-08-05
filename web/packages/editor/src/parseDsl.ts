// DSL v2 -> canvas ModelDocument (the reverse of generateDsl). Parses the
// full grammar on a line/semicolon basis: use / param / resource, the
// container kinds (process / agent / atomic / continuous / experiment,
// recursively nested), arbitrary declaration blocks (source/queue/... and
// unknown kinds), field lines (key = value, typed states, `d y/dt` ODE
// equations), behavior blocks (on_<trigger> { effects }) and instance
// references. Kinds the canvas does not render yet become placeholder nodes
// (parsed, never dropped), so the model tree survives any DSL the AI or a
// user writes. Process stages are coupled in declaration order.

import type { BlockKind, ModelDocument, ModelNode } from './graph.js';
import { connect, createDocument, freshId } from './graph.js';

/** One structured DSL/project diagnostic. Error families follow
 *  project-format-v2: LP2xxx structure parsing, LP3xxx references. */
export interface DslDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParseResult {
  ok: boolean;
  document: ModelDocument;
  error?: string;
  diagnostics?: DslDiagnostic[];
}

type Token =
  | { type: 'word'; text: string }
  | { type: 'number'; text: string }
  | { type: 'string'; text: string }
  | { type: 'punct'; text: string }
  | { type: 'newline'; text: string };

/** Container kinds: their members are nested children (one scene file per
 *  container in the on-disk layout). */
const CONTAINER_KINDS: ReadonlySet<string> = new Set([
  'process',
  'agent',
  'atomic',
  'continuous',
  'experiment',
]);

/** Kinds the canvas renders natively; everything else is a placeholder
 *  node (grey frame, read-only) so no DSL member is ever dropped. */
const CANVAS_KINDS: ReadonlySet<string> = new Set([
  'resource',
  'source',
  'queue',
  'service',
  'sink',
  ...CONTAINER_KINDS,
]);

const PUNCT = '{}()=,;:/*+->.';

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
    if (c === '\n') {
      tokens.push({ type: 'newline', text: '\n' });
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < n && source[j] !== '"') {
        text += source[j]!;
        j++;
      }
      if (j >= n) {
        return 'unterminated string literal';
      }
      tokens.push({ type: 'string', text });
      i = j + 1;
      continue;
    }
    if (isWordStart(c)) {
      let j = i;
      while (j < n && isWord(source[j]!)) j++;
      tokens.push({ type: 'word', text: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(source[j]!)) j++;
      tokens.push({ type: 'number', text: source.slice(i, j) });
      i = j;
      continue;
    }
    if (PUNCT.includes(c)) {
      tokens.push({ type: 'punct', text: c });
      i++;
      continue;
    }
    return `unexpected character '${c}' at offset ${i}`;
  }
  return tokens;
}

/** One parsed body member. `field` covers key = value lines (including
 *  typed `state x: type = v` and `d y/dt = expr`), `block` covers
 *  kind-name declarations, `behavior` covers on_<trigger> blocks, `effect`
 *  covers bare lines inside a behavior, `use`/`param` are the special
 *  member lines. */
interface BodyMember {
  kind: string;
  name: string;
  params: Record<string, string | number | boolean>;
  children: BodyMember[];
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  atPunct(text: string): boolean {
    const token = this.peek();
    return token !== undefined && token.type === 'punct' && token.text === text;
  }

  expectPunct(text: string): boolean {
    if (this.atPunct(text)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectWord(match?: string): string | null {
    const token = this.peek();
    if (
      token !== undefined &&
      token.type === 'word' &&
      (match === undefined || token.text === match)
    ) {
      this.pos++;
      return token.text;
    }
    return null;
  }

  private isSeparator(token: Token | undefined): boolean {
    return (
      token === undefined ||
      token.type === 'newline' ||
      (token.type === 'punct' && (token.text === ';' || token.text === '}'))
    );
  }

  /** Join member tokens back into a readable string: words keep a space
   *  between them, punctuation hugs its neighbours (d y/dt, -k*y), except a
   *  colon followed by a word (`state x: bool`). */
  private static joinTokens(parts: Array<{ text: string }>): string {
    let out = '';
    for (const part of parts) {
      const prevAlpha = /[A-Za-z0-9_)]$/.test(out);
      const curAlpha = /^[A-Za-z0-9_("]/.test(part.text);
      const afterColon = out.endsWith(':');
      out += curAlpha && (prevAlpha || afterColon) ? ` ${part.text}` : part.text;
    }
    return out.trim();
  }

  /** Read one field value: tokens up to a separator, rebuilt into a string
   *  (or kept as a number when it is a single literal). Calls like
   *  rate(0.8) and expressions like -k*y are reconstructed. */
  private readValue(): string | number | boolean {
    const parts: string[] = [];
    let literalOnly = true;
    for (;;) {
      const token = this.peek();
      if (this.isSeparator(token)) {
        break;
      }
      this.next();
      if (
        token!.type === 'word' &&
        this.peek()?.type === 'punct' &&
        this.peek()!.text === '('
      ) {
        this.next();
        parts.push(`${token!.text}(${this.captureParens()}`);
        literalOnly = false;
        continue;
      }
      if (token!.type === 'punct' && token!.text === '(') {
        parts.push(`(${this.captureParens()}`);
        literalOnly = false;
        continue;
      }
      if (token!.type === 'string') {
        parts.push(JSON.stringify(token!.text));
        literalOnly = false;
        continue;
      }
      parts.push(token!.text);
      if (
        token!.type !== 'number' ||
        !Number.isFinite(Number(token!.text))
      ) {
        literalOnly = false;
      }
    }
    if (parts.length === 1) {
      const only = parts[0]!;
      if (only === 'true' || only === 'false') {
        return only === 'true';
      }
      const numeric = Number(only);
      return /^-?[0-9.eE+-]+$/.test(only) && Number.isFinite(numeric)
        ? numeric
        : only;
    }
    return Parser.joinTokens(parts.map((part) => ({ text: part })));
  }

  /** Consume balanced parentheses and rebuild their content. */
  private captureParens(): string {
    let out = '';
    let depth = 0;
    for (;;) {
      const token = this.next();
      if (token === undefined) break;
      if (token.type === 'punct' && token.text === '(') {
        depth++;
        out += '(';
      } else if (token.type === 'punct' && token.text === ')') {
        out += ')';
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (token.type === 'punct' && token.text === ',') {
        out += ', ';
      } else if (token.type === 'newline' || token.type === 'punct') {
        out += token.text;
      } else {
        out += token.text;
      }
    }
    return out;
  }

  /** Parse one body (model root or a container) into members. */
  parseBody(): BodyMember[] | string {
    const members: BodyMember[] = [];
    for (;;) {
      while (this.atPunct(';') || this.peek()?.type === 'newline') {
        this.next();
      }
      if (this.atPunct('}')) {
        break;
      }
      if (this.peek() === undefined) {
        return 'unexpected end of input (missing closing brace)';
      }
      if (this.expectWord('use') !== null) {
        const name = this.expectWord();
        if (name === null) {
          return "expected a library name after 'use'";
        }
        members.push({ kind: 'use', name, params: {}, children: [] });
        continue;
      }
      if (this.expectWord('param') !== null) {
        const name = this.expectWord();
        if (name === null) {
          return "expected 'param <name>[: <type>] = <value>'";
        }
        let type = '';
        if (this.expectPunct(':')) {
          const typeWord = this.expectWord();
          if (typeWord === null) {
            return "expected a type after 'param <name>:'";
          }
          type = typeWord;
        }
        if (!this.expectPunct('=')) {
          return "expected 'param <name>[: <type>] = <value>'";
        }
        members.push({
          kind: 'param',
          name,
          params: { type, value: this.readValue() },
          children: [],
        });
        continue;
      }
      const member = this.parseMember();
      if (typeof member === 'string') {
        return member;
      }
      members.push(member);
    }
    return members;
  }

  private parseMember(): BodyMember | string {
    const head: Token[] = [];
    for (;;) {
      const token = this.peek();
      if (this.isSeparator(token)) {
        break;
      }
      if (token!.type === 'punct' && token!.text === '{') {
        this.next();
        if (head.length === 1 && head[0]!.text.startsWith('on_')) {
          const children = this.parseBody();
          if (typeof children === 'string') {
            return children;
          }
          if (!this.expectPunct('}')) {
            return `unterminated behavior '${head[0]!.text}'`;
          }
          return {
            kind: head[0]!.text,
            name: head[0]!.text,
            params: {},
            children,
          };
        }
        if (head.length === 2) {
          const children = this.parseBody();
          if (typeof children === 'string') {
            return children;
          }
          if (!this.expectPunct('}')) {
            return `unterminated ${head[0]!.text} '${head[1]!.text}'`;
          }
          return {
            kind: head[0]!.text,
            name: head[1]!.text,
            params: {},
            children,
          };
        }
        return "expected 'kind name { ... }'";
      }
      if (token!.type === 'punct' && token!.text === '=') {
        this.next();
        return {
          kind: 'field',
          name: Parser.joinTokens(head),
          params: { value: this.readValue() },
          children: [],
        };
      }
      if (token!.type === 'punct' && token!.text === ':') {
        // Typed state: `state x: type = value` - keep the whole key.
        head.push(this.next()!);
        continue;
      }
      head.push(this.next()!);
    }
    if (head.length === 0) {
      return 'expected a member';
    }
    // A bare line (e.g. an effect inside a behavior): keep it verbatim.
    return {
      kind: 'effect',
      name: head.map((entry) => entry.text).join(' '),
      params: {},
      children: [],
    };
  }
}

export function parseDsl(source: string): ParseResult {
  const fail = (error: string): ParseResult => ({
    ok: false,
    document: createDocument('Model'),
    error,
    diagnostics: [{ code: 'LP2101', severity: 'error', message: error }],
  });

  const tokens = tokenize(source);
  if (typeof tokens === 'string') {
    return fail(tokens);
  }
  const parser = new Parser(tokens);
  // Leading comments/blank lines produce newline tokens before `model`.
  while (parser.peek()?.type === 'newline') {
    parser.next();
  }
  if (parser.expectWord('model') === null) {
    return fail("expected 'model' at the start of the source");
  }
  const modelName = parser.expectWord();
  if (modelName === null || !parser.expectPunct('{')) {
    return fail("expected a model name and '{'");
  }
  const members = parser.parseBody();
  if (typeof members === 'string') {
    return fail(members);
  }
  if (!parser.expectPunct('}')) {
    return fail('unterminated model body');
  }
  while (parser.peek()?.type === 'newline') {
    parser.next();
  }
  if (parser.peek() !== undefined) {
    return fail('unexpected content after the model');
  }

  const document = createDocument(modelName);
  const nodes: ModelNode[] = [];
  const diagnostics: DslDiagnostic[] = [];
  // Duplicate-name validation (LP3103): members must be unique within their
  // container. Behavior blocks (on_*) are exempt - a container may hold
  // several behaviors with the same trigger.
  const seenNames = new Map<string, Set<string>>();
  // Sequential stage order per process container (declaration order).
  const processStages = new Map<string, ModelNode[]>();
  let order = 0;

  const position = () => {
    const x = 160 + (order % 8) * 180;
    const y = 80 + Math.floor(order / 8) * 100;
    order += 1;
    return { x, y };
  };

  const flatten = (
    member: BodyMember,
    parent: string | undefined,
    parentKind: string | undefined,
  ): void => {
    if (!member.kind.startsWith('on_')) {
      const scope = parent ?? '';
      const seen = seenNames.get(scope) ?? new Set<string>();
      if (seen.has(member.name)) {
        diagnostics.push({
          code: 'LP3103',
          severity: 'warning',
          message: `duplicate member name '${member.name}' in '${scope || 'model'}'`,
        });
      }
      seen.add(member.name);
      seenNames.set(scope, seen);
    }
    const pos = position();
    if (member.kind === 'field' || member.kind === 'effect') {
      nodes.push({
        id: freshId('member'),
        kind: member.kind,
        name: member.name,
        x: pos.x,
        y: pos.y,
        params: { ...member.params },
        container: parent,
        placeholder: true,
      });
      return;
    }
    if (member.kind === 'use' || member.kind === 'param') {
      nodes.push({
        id: freshId(member.kind),
        kind: member.kind,
        name: member.name,
        x: pos.x,
        y: pos.y,
        params: { ...member.params },
        container: parent,
        placeholder: !CANVAS_KINDS.has(member.kind),
      });
      return;
    }
    if (member.kind.startsWith('on_')) {
      nodes.push({
        id: freshId('behavior'),
        kind: member.kind,
        name: member.name,
        x: pos.x,
        y: pos.y,
        params: {},
        container: parent,
        placeholder: true,
      });
      for (const child of member.children) {
        flatten(child, member.name, member.kind);
      }
      return;
    }
    // A declaration block: merge its field lines into params, keep nested
    // blocks / behaviors as children.
    const params: Record<string, string | number | boolean> = {};
    const nested: BodyMember[] = [];
    for (const child of member.children) {
      if (child.kind === 'field') {
        params[child.name] = child.params['value'] ?? '';
      } else {
        nested.push(child);
      }
    }
    const node: ModelNode = {
      id: freshId(member.kind),
      kind: member.kind,
      name: member.name,
      x: pos.x,
      y: pos.y,
      params,
      container: parent,
      placeholder: !CANVAS_KINDS.has(member.kind),
    };
    nodes.push(node);
    for (const child of nested) {
      flatten(child, member.name, member.kind);
    }
    if (parentKind === 'process' && !CONTAINER_KINDS.has(member.kind)) {
      const group = processStages.get(parent ?? '');
      if (group) {
        group.push(node);
      } else {
        processStages.set(parent ?? '', [node]);
      }
    }
  };

  for (const member of members) {
    flatten(member, undefined, undefined);
  }

  let doc: ModelDocument = { ...document, nodes };
  for (const group of processStages.values()) {
    for (let i = 0; i + 1 < group.length; i++) {
      doc = connect(doc, group[i]!.id, group[i + 1]!.id).document;
    }
  }
  return { ok: true, document: doc, diagnostics };
}
