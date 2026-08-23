// SysML v2 semantic-execution MVP, controlled subset
// (workbench-architecture-plan.md §8 S2). This module derives explicit
// ExecutionTargets from a parsed projection and executes the subset the
// conformance matrix below declares SUPPORTED - nothing more. Unsupported
// constructs are reported up-front and never guessed (plan §13).
//
// Subset 0.1: attribute expressions over numbers (+ - * / parens, unary
// minus, references to sibling attributes) evaluated as ordered assignment
// successions inside `action` and `calculation` elements.

import type { SysMLProjection, SysMLVisualKind } from './sysmlProjection';

export const SYSML_EXECUTION_CONFORMANCE_VERSION = '0.1.0';

export type ConformanceLevel = 'supported' | 'planned' | 'unsupported';

export interface ConformanceRow {
  construct: string;
  level: ConformanceLevel;
  note?: string;
}

/** Versioned semantic-conformance matrix (plan §8 S2). Rows are additive:
 *  a level may move to 'supported' in later versions but never silently
 *  regress; tests pin this table. */
export const SYSML_CONFORMANCE_MATRIX: readonly ConformanceRow[] = [
  { construct: 'numeric expression arithmetic (+ - * / parentheses)', level: 'supported' },
  { construct: 'attribute references within one element scope', level: 'supported' },
  { construct: 'calculation usage evaluation', level: 'supported' },
  { construct: 'action usage with assignment succession', level: 'supported' },
  { construct: 'state transitions', level: 'planned', note: 'targeted for execution 0.2' },
  { construct: 'relative/absolute time triggers (after/at)', level: 'unsupported' },
  { construct: 'continuous ODE fragments', level: 'unsupported' },
];

const EXECUTABLE_KINDS: ReadonlySet<SysMLVisualKind> = new Set([
  'action',
  'calculation',
  'state',
  'analysis',
  'verification',
]);

export interface SysMLExecutionTarget {
  id: string;
  kind: SysMLVisualKind;
  qualifiedName: string;
  supported: boolean;
  /** Empty when supported; otherwise why interpreter 0.1 declines it. */
  reasons: string[];
}

export interface TraceStep {
  index: number;
  description: string;
  value: number | null;
  line?: number;
}

export interface SysMLRunResult {
  ok: boolean;
  targetId: string;
  steps?: TraceStep[];
  result?: number | null;
  error?: string;
  line?: number;
}

function childrenOf(projection: SysMLProjection, ownerId: string) {
  return projection.elements.filter((element) => element.ownerId === ownerId);
}

/** Extract ExecutionTargetRefs per plan §8 S2: executable element usages get
 *  an explicit target entry - pure structure/requirement models produce an
 *  EMPTY list, so no Run affordance is ever shown for them. */
export function extractExecutionTargets(
  source: string,
  projection: SysMLProjection,
): SysMLExecutionTarget[] {
  const lines = source.split(/\r?\n/);
  const targets: SysMLExecutionTarget[] = [];
  for (const element of projection.elements) {
    if (!EXECUTABLE_KINDS.has(element.kind)) continue;
    const reasons: string[] = [];
    if (element.kind === 'state') {
      reasons.push('state transitions are planned for execution 0.2');
    }
    if (element.kind === 'analysis' || element.kind === 'verification') {
      reasons.push(`${element.kind} cases need an external analysis adapter (not bundled)`);
    }
    const bodyLines: string[] = [];
    for (const child of childrenOf(projection, element.id)) {
      if (child.kind !== 'attribute') {
        reasons.push(`nested ${child.kind} '${child.name}' is outside subset 0.1`);
        continue;
      }
      const line = lines[child.span.line - 1] ?? '';
      if (/\b(after|at)\s+\S/.test(line)) {
        reasons.push(`time trigger on '${child.name}' is unsupported`);
      }
      bodyLines.push(line);
    }
    // A time trigger directly inside the header line counts too.
    const ownLine = lines[element.span.line - 1] ?? '';
    if (/\b(after|at)\s+\d/.test(ownLine)) {
      reasons.push('time trigger is unsupported');
    }
    targets.push({
      id: element.id,
      kind: element.kind,
      qualifiedName: element.qualifiedName,
      supported: reasons.length === 0,
      reasons,
    });
  }
  return targets;
}

interface Token {
  type: 'number' | 'ident' | 'op';
  text: string;
}

function tokenize(expr: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j += 1;
      tokens.push({ type: 'number', text: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j]!)) j += 1;
      tokens.push({ type: 'ident', text: expr.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: 'op', text: ch });
      i += 1;
      continue;
    }
    return `unexpected character '${ch}'`;
  }
  return tokens;
}

/** Recursive-descent evaluation of the numeric subset. No eval(), no
 *  globals: identifiers resolve only against `env`. */
function evaluateExpression(expr: string, env: Map<string, number>): number {
  const tokensOrError = tokenize(expr);
  if (typeof tokensOrError === 'string') throw new Error(tokensOrError);
  const tokens = tokensOrError;
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (text: string) => {
    const token = peek();
    if (token !== undefined && token.type === 'op' && token.text === text) {
      pos += 1;
      return true;
    }
    return false;
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (token === undefined) throw new Error('unexpected end of expression');
    if (token.type === 'number') {
      pos += 1;
      const value = Number(token.text);
      if (!Number.isFinite(value)) throw new Error(`bad number '${token.text}'`);
      return value;
    }
    if (token.type === 'ident') {
      pos += 1;
      const value = env.get(token.text);
      if (value === undefined) throw new Error(`unknown identifier '${token.text}'`);
      return value;
    }
    if (token.text === '(') {
      pos += 1;
      const value = parseSum();
      if (!eat(')')) throw new Error("expected ')'");
      return value;
    }
    if (token.text === '-') {
      pos += 1;
      return -parsePrimary();
    }
    throw new Error(`unexpected token '${token.text}'`);
  };

  const parseProduct = (): number => {
    let value = parsePrimary();
    for (;;) {
      if (eat('*')) value *= parsePrimary();
      else if (eat('/')) {
        const divisor = parsePrimary();
        if (divisor === 0) throw new Error('division by zero');
        value /= divisor;
      } else return value;
    }
  };

  const parseSum = (): number => {
    let value = parseProduct();
    for (;;) {
      if (eat('+')) value += parseProduct();
      else if (eat('-')) value -= parseProduct();
      else return value;
    }
  };

  const value = parseSum();
  if (pos !== tokens.length) throw new Error(`trailing input near '${tokens[pos]!.text}'`);
  return value;
}

/** The assigned expression of one attribute member, taken from its source
 *  line after the identifier (`attribute mass = 35 * fudge;`). */
function assignedExpression(source: string, nameSpanEnd: number): string | null {
  const lineEnd = source.indexOf('\n', nameSpanEnd);
  const tail = source.slice(nameSpanEnd, lineEnd === -1 ? undefined : lineEnd);
  const match = /=\s*([^;]+)/.exec(tail);
  return match ? match[1]!.trim() : null;
}

/** Execute one supported target deterministically: attributes evaluate in
 *  declaration order, each producing a trace step bound to its source line.
 *  Calculations report their last computed value as the result. */
export function runExecutionTarget(
  source: string,
  projection: SysMLProjection,
  targetId: string,
): SysMLRunResult {
  const targets = extractExecutionTargets(source, projection);
  const target = targets.find((entry) => entry.id === targetId);
  if (target === undefined) {
    return { ok: false, targetId, error: 'unknown execution target' };
  }
  if (!target.supported) {
    return { ok: false, targetId, error: `unsupported target: ${target.reasons.join('; ')}` };
  }

  const env = new Map<string, number>();
  const steps: TraceStep[] = [];
  let last: number | null = null;
  let currentLine: number | undefined;
  const members = childrenOf(projection, targetId).filter((child) => child.kind === 'attribute');
  try {
    for (const member of members) {
      currentLine = member.span.line;
      const expr = assignedExpression(source, member.nameSpan.end);
      if (expr === null) {
        return {
          ok: false,
          targetId,
          error: `attribute '${member.name}' has no assigned value`,
          line: member.span.line,
        };
      }
      const value = evaluateExpression(expr, env);
      env.set(member.name, value);
      last = value;
      steps.push({
        index: steps.length,
        description: `${member.name} := ${expr}`,
        value,
        line: member.span.line,
      });
    }
  } catch (error) {
    return {
      ok: false,
      targetId,
      error: error instanceof Error ? error.message : String(error),
      line: currentLine,
    };
  }

  if (members.length === 0) {
    return { ok: false, targetId, error: 'the target has no assignable attributes to execute' };
  }
  return {
    ok: true,
    targetId,
    steps,
    result: target.kind === 'calculation' ? last : null,
  };
}
