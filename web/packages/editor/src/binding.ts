// Simulation binding: drive a GraphicNode's live transform/style from
// runtime simulation variables (queueLength, busy, servers, downServers,
// tick) through small arithmetic expressions.
//
// `evalBindingExpression` is a tiny safe recursive-descent evaluator:
// numbers, identifiers, + - * / % ( ) and unary minus only. No functions,
// no assignment, no object access - a project file cannot smuggle code
// through a binding expression.

import type { GraphicNode } from './presentation.js';

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string };

function tokenize(source: string): { tokens: Token[]; ok: boolean } {
  const tokens: Token[] = [];
  const re = /\s*([0-9]*\.?[0-9]+|[A-Za-z_][A-Za-z0-9_]*|[+\-*/%()])/g;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = re.exec(source)) !== null) {
    if (match[1] === undefined || source.slice(last, match.index).trim() !== '') {
      return { tokens, ok: false };
    }
    const text = match[1]!;
    if (/^[0-9]/.test(text)) {
      tokens.push({ type: 'number', value: parseFloat(text) });
    } else if (/^[A-Za-z_]/.test(text)) {
      tokens.push({ type: 'ident', value: text });
    } else {
      tokens.push({ type: 'op', value: text });
    }
    last = re.lastIndex;
  }
  return { tokens, ok: source.slice(last).trim() === '' };
}

export function evalBindingExpression(source: string, vars: Record<string, number>): number {
  const { tokens, ok } = tokenize(source);
  if (!ok || tokens.length === 0) {
    return 0;
  }
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  const parseFactor = (): number => {
    const token = peek();
    if (!token) {
      return 0;
    }
    if (token.type === 'op' && token.value === '-') {
      next();
      return -parseFactor();
    }
    if (token.type === 'op' && token.value === '(') {
      next();
      const value = parseExpr();
      if (peek()?.type === 'op' && peek()!.value === ')') {
        next();
      }
      return value;
    }
    if (token.type === 'number') {
      next();
      return token.value;
    }
    if (token.type === 'ident') {
      next();
      const value = vars[token.value];
      return typeof value === 'number' ? value : 0;
    }
    return 0;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (
      peek()?.type === 'op' &&
      (peek()!.value === '*' || peek()!.value === '/' || peek()!.value === '%')
    ) {
      const op = next()!.value as string;
      const rhs = parseFactor();
      if (op === '*') value *= rhs;
      else if (op === '/') value = rhs === 0 ? 0 : value / rhs;
      else value %= rhs;
    }
    return value;
  };

  const parseExpr = (): number => {
    let value = parseTerm();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = next()!.value as string;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };

  const result = parseExpr();
  return Number.isFinite(result) ? result : 0;
}

/** Property keys a binding may drive, with clamping rules. */
const BINDABLE: Record<
  string,
  {
    transform?: 'x' | 'y' | 'width' | 'height' | 'rotation';
    style?: 'opacity';
    min?: number;
    max?: number;
  }
> = {
  x: { transform: 'x' },
  y: { transform: 'y' },
  width: { transform: 'width', min: 1 },
  height: { transform: 'height', min: 1 },
  rotation: { transform: 'rotation' },
  opacity: { style: 'opacity', min: 0, max: 1 },
};

/** Apply a node's binding over the current runtime variables, returning a
 *  cloned node with the overlaid transform/style (the stored node is never
 *  mutated). */
export function resolveGraphicBindings(
  node: GraphicNode,
  runtime: Record<string, number>,
): GraphicNode {
  const binding = node.binding;
  if (!binding) {
    return node;
  }
  const resolved: GraphicNode = {
    ...node,
    transform: { ...node.transform },
    style: { ...node.style, stroke: { ...node.style.stroke } },
  };
  for (const [key, expression] of Object.entries(binding.properties)) {
    const rule = BINDABLE[key];
    if (!rule || !expression.trim()) {
      continue;
    }
    let value = evalBindingExpression(expression, runtime);
    if (rule.min !== undefined) value = Math.max(rule.min, value);
    if (rule.max !== undefined) value = Math.min(rule.max, value);
    if (rule.transform) {
      resolved.transform[rule.transform] = value;
    } else if (rule.style) {
      resolved.style[rule.style] = value;
    }
  }
  return resolved;
}
