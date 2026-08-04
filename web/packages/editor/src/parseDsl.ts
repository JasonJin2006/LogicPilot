// DSL v2 -> canvas ModelDocument (the reverse of generateDsl). Supports the
// process-library subset the canvas models: model { use?, param*, resource*,
// process { source/queue/service/sink } }. Blocks are laid out left to right
// and process stages are coupled in declaration order (the DSL's sequential
// flow semantics), matching what generateDsl emits.

import type { BlockKind, ModelDocument, ModelNode } from './graph.js';
import { connect, createDocument, freshId } from './graph.js';

export interface ParseResult {
  ok: boolean;
  document: ModelDocument;
  error?: string;
}

type Token =
  | { type: 'word'; text: string }
  | { type: 'number'; text: string }
  | { type: 'string'; text: string }
  | { type: 'punct'; text: string };

const PROCESS_KINDS: ReadonlySet<string> = new Set([
  'source',
  'queue',
  'service',
  'sink',
]);

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
    if ('{}()=,:'.includes(c)) {
      tokens.push({ type: 'punct', text: c });
      i++;
      continue;
    }
    return `unexpected character '${c}' at offset ${i}`;
  }
  return tokens;
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

  // One `key = value` field value: number, string, bare identifier, or a
  // function call like rate(0.8) rebuilt from tokens.
  parseValue(): string | number {
    const token = this.next();
    if (token === undefined) return '';
    if (token.type === 'number') {
      return Number(token.text);
    }
    if (token.type === 'string') {
      return token.text;
    }
    if (token.type === 'word' && this.atPunct('(')) {
      return token.text + this.captureParens();
    }
    return token.text;
  }

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
        depth--;
        out += ')';
        if (depth === 0) break;
      } else if (token.type === 'punct' && token.text === ',') {
        out += ', ';
      } else {
        out += token.text;
      }
    }
    return out;
  }

  parseFields(): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};
    while (!this.atPunct('}')) {
      const key = this.expectWord();
      if (key === null || !this.expectPunct('=')) {
        return params;
      }
      params[key] = this.parseValue();
    }
    return params;
  }
}

export function parseDsl(source: string): ParseResult {
  const fail = (error: string): ParseResult => ({
    ok: false,
    document: createDocument('Model'),
    error,
  });

  const tokens = tokenize(source);
  if (typeof tokens === 'string') {
    return fail(tokens);
  }
  const parser = new Parser(tokens);
  if (parser.expectWord('model') === null) {
    return fail("expected 'model' at the start of the source");
  }
  const modelName = parser.expectWord();
  if (modelName === null || !parser.expectPunct('{')) {
    return fail("expected a model name and '{'");
  }

  const resources: Array<{ name: string; params: Record<string, string | number | boolean> }> = [];
  const stages: Array<{
    kind: BlockKind;
    name: string;
    params: Record<string, string | number | boolean>;
  }> = [];

  while (!parser.atPunct('}')) {
    if (parser.expectWord('use') !== null) {
      parser.expectWord(); // library name
      continue;
    }
    if (parser.expectWord('param') !== null) {
      parser.expectWord(); // param name
      parser.expectPunct(':');
      parser.expectWord(); // type
      parser.expectPunct('=');
      parser.parseValue();
      continue;
    }
    if (parser.expectWord('resource') !== null) {
      const name = parser.expectWord();
      if (name === null || !parser.expectPunct('{')) {
        return fail(`expected a name and '{' for resource`);
      }
      const params = parser.parseFields();
      if (!parser.expectPunct('}')) {
        return fail(`unterminated resource '${name}'`);
      }
      resources.push({ name, params });
      continue;
    }
    if (parser.expectWord('process') !== null) {
      parser.expectWord(); // process name
      if (!parser.expectPunct('{')) {
        return fail("expected '{' after process name");
      }
      while (!parser.atPunct('}')) {
        const kind = parser.expectWord();
        const name = parser.expectWord();
        if (kind === null || name === null) {
          return fail('expected a block kind and name in the process');
        }
        if (!PROCESS_KINDS.has(kind)) {
          return fail(`unsupported process block '${kind}' (only source/queue/service/sink)`);
        }
        if (!parser.expectPunct('{')) {
          return fail(`expected '{' for process block '${name}'`);
        }
        const params = parser.parseFields();
        if (!parser.expectPunct('}')) {
          return fail(`unterminated process block '${name}'`);
        }
        stages.push({ kind: kind as BlockKind, name, params });
      }
      if (!parser.expectPunct('}')) {
        return fail('unterminated process block');
      }
      continue;
    }
    return fail(
      `unsupported top-level block (only resource/process can load into the canvas)`,
    );
  }

  if (stages.length === 0) {
    return fail('the model has no process flow to load into the canvas');
  }

  const document = createDocument(modelName);
  const nodes: ModelNode[] = [];
  resources.forEach((resource, index) => {
    nodes.push({
      id: freshId('resource'),
      kind: 'resource',
      name: resource.name,
      x: 120,
      y: 80 + index * 100,
      params: { ...resource.params },
    });
  });
  stages.forEach((stage, index) => {
    nodes.push({
      id: freshId(stage.kind),
      kind: stage.kind,
      name: stage.name,
      x: 160 + index * 180,
      y: 240,
      params: { ...stage.params },
    });
  });

  let doc: ModelDocument = { ...document, nodes };
  for (let i = 0; i + 1 < stages.length; i++) {
    const from = nodes[resources.length + i]!;
    const to = nodes[resources.length + i + 1]!;
    doc = connect(doc, from.id, to.id).document;
  }
  return { ok: true, document: doc };
}
