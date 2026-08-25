// SysML v2 semantic-execution MVP, controlled subset
// (workbench-architecture-plan.md §8 S2). This module derives explicit
// ExecutionTargets from a parsed projection and executes the subset the
// conformance matrix below declares SUPPORTED - nothing more. Unsupported
// constructs are reported up-front and never guessed (plan §13).
//
// Subset 0.1: attribute expressions over numbers (+ - * / parens, unary
// minus, references to sibling attributes) evaluated as ordered assignment
// successions inside `action` and `calculation` elements.
// Subset 0.2: deterministic state-machine interpretation - nested states,
// `transition a then b` successions and relative/absolute NUMERIC time
// triggers (`after 5 s`, `at 10`) stepped by a discrete-event clock with an
// explicit initial-state rule, earliest-fire selection, Zeno detection and a
// step budget. Guards (when/otherwise), hierarchical states and unit
// conversion remain OUTSIDE the subset and decline targets up-front.

import type {
  SysMLElement,
  SysMLProjection,
  SysMLRelation,
  SysMLVisualKind,
} from './sysmlProjection';

export const SYSML_EXECUTION_CONFORMANCE_VERSION = '0.2.0';

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
  { construct: 'flat state machines (nested states + transition succession)', level: 'supported' },
  {
    construct: 'relative/absolute time triggers (after/at numeric literals)',
    level: 'supported',
    note: 'units recorded verbatim, never converted',
  },
  // --- wide-parse slice (visualization layer) ---
  {
    construct: 'quoted identifiers as element names and references (SysML spec spelling)',
    level: 'supported',
    note: 'declarations and qualified refs de-quoted; ids/nameSpans stay byte-stable',
  },
  {
    construct: 'import directives (so that "Pkg::*") and doc/metadata keywords',
    level: 'supported',
    note: 'accepted as directives/prose, never visual elements',
  },
  {
    construct: 'enum def members and typed usages with multiplicities (part : T [4])',
    level: 'supported',
    note: 'enumerated values render as children of the enum def; multiplicity recorded, not evaluated',
  },
  {
    construct:
      'multi-line transitions (first/effect clauses) and `first start then X` entry markers',
    level: 'supported',
    note: 'scanner accumulates to `;`; effect actions accepted, not interpreted',
  },
  {
    construct: 'exhibit state / exhibit part inside a part body',
    level: 'supported',
    note: 'accepted and contained; typed_by recorded, machine semantics not applied',
  },
  // --- linked multi-file slice (visualization layer) ---
  {
    construct: 'multi-file projects: import-closure loading and cross-file reference resolution',
    level: 'supported',
    note: 'visualization only; execution/lowering stay per-file on the owning unit',
  },
  {
    construct: 'standard-library typed usages (ScalarValues scalars, SI quantities)',
    level: 'supported',
    note: 'external by design - resolved silently, never SY0002 noise',
  },
  {
    construct: 'use-case diagrams: usecase bodies with actor participants and a subject part',
    level: 'supported',
    note: 'classic ellipse + stick-figure actors + subject box with association lines',
  },
  {
    construct:
      'parametric diagrams: constraint binding expressions (quoted refs with comparison/arithmetic)',
    level: 'supported',
    note: 'bindings visualized with the expression as label; expressions are never evaluated',
  },
  {
    construct:
      'sequence diagrams: interaction bodies with actor participants and message/reply ... from ... to ...',
    level: 'supported',
    note: 'lifelines in declaration order, arrows ordered by source line; fragments (alt/loop) are outside the subset',
  },
  {
    construct:
      'continuation clauses (:>/:>> specializations, feature value assignments, wrapped type clauses, assert constraint bodies)',
    level: 'supported',
    note: 'accepted as prose of the owning declaration; values/constraint expressions are not interpreted',
  },
  {
    construct: 'guard conditions (when/otherwise)',
    level: 'planned',
    note: 'targeted for a later execution slice; parser still rejects via SY0001.',
  },
  {
    construct: 'hierarchical (nested) state decomposition',
    level: 'planned',
    note: 'entry/exit semantics not interpreted in 0.2',
  },
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
  /** Empty when supported; otherwise why this interpreter declines it. */
  reasons: string[];
}

export interface TraceStep {
  index: number;
  description: string;
  value: number | null;
  line?: number;
  /** Discrete-event clock reading at which the step happens (state machines,
   *  execution 0.2). Absent for pure assignment successions. */
  time?: number;
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

/** All element ids strictly BELOW `rootId` in the containment tree. */
function descendantsOf(projection: SysMLProjection, rootId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (ownerId: string) => {
    for (const element of projection.elements) {
      if (element.ownerId === ownerId && !ids.has(element.id)) {
        ids.add(element.id);
        walk(element.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

function describeTrigger(trigger: NonNullable<SysMLRelation['trigger']>): string {
  const unit = trigger.unit ? ` ${trigger.unit}` : '';
  return `${trigger.kind} ${trigger.amount}${unit}`;
}

/** Structural analysis of one `state` machine against subset 0.2. Returns
 *  why it is NOT executable; an empty list means supported. */
function analyzeStateMachine(
  projection: SysMLProjection,
  machine: SysMLElement,
  lines: string[],
): string[] {
  const reasons: string[] = [];
  // Flat machines only: every direct child must be a plain state or a
  // machine-level attribute, and states themselves must be leaves.
  let stateCount = 0;
  for (const child of childrenOf(projection, machine.id)) {
    if (child.kind === 'attribute') continue;
    if (child.kind !== 'state') {
      reasons.push(`nested ${child.kind} '${child.name}' is outside the executable subset`);
      continue;
    }
    stateCount += 1;
    if (projection.elements.some((nested) => nested.ownerId === child.id)) {
      reasons.push(`hierarchical nesting inside state '${child.name}' is outside subset 0.2`);
    }
  }
  if (stateCount === 0) reasons.push('the state machine has no nested states to execute');
  // A transition touching exactly one side of this machine crosses its
  // boundary; both-outside transitions belong to other machines.
  const scopeIds = descendantsOf(projection, machine.id);
  scopeIds.add(machine.id);
  for (const relation of projection.relations) {
    if (relation.kind !== 'transitions') continue;
    if (scopeIds.has(relation.from) !== scopeIds.has(relation.to)) {
      reasons.push(`transition on line ${relation.line} crosses the machine boundary`);
    }
  }
  // A time trigger directly inside the header line counts too.
  const ownLine = lines[machine.span.line - 1] ?? '';
  if (/\b(after|at)\s+\d/.test(ownLine)) {
    reasons.push('time trigger is unsupported');
  }
  return reasons;
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
    let reasons: string[];
    switch (element.kind) {
      case 'state':
        reasons = analyzeStateMachine(projection, element, lines);
        break;
      case 'analysis':
      case 'verification':
        reasons = [`${element.kind} cases need an external analysis adapter (not bundled)`];
        break;
      default: {
        // action/calculation keep the 0.1 assignment-succession rules.
        reasons = [];
        for (const child of childrenOf(projection, element.id)) {
          if (child.kind !== 'attribute') {
            reasons.push(`nested ${child.kind} '${child.name}' is outside the executable subset`);
            continue;
          }
          const line = lines[child.span.line - 1] ?? '';
          if (/\b(after|at)\s+\S/.test(line)) {
            reasons.push(`time trigger on '${child.name}' is unsupported`);
          }
        }
        const ownLine = lines[element.span.line - 1] ?? '';
        if (/\b(after|at)\s+\d/.test(ownLine)) {
          reasons.push('time trigger is unsupported');
        }
      }
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

interface MachineLimits {
  maxTransitions: number;
  /** Zero-time fires allowed in a row before the run is declared a Zeno
   *  cycle instead of looping silently forever. */
  zenoLimit: number;
}

const MACHINE_LIMITS: MachineLimits = { maxTransitions: 200, zenoLimit: 64 };

interface TransitionEdge {
  relation: SysMLRelation;
  /** Earliest clock time at which this edge can fire from a given entry. */
  fireAt: (now: number, enteredAt: number) => number;
}

/** Deterministic discrete-event stepping of one flat state machine.
 *
 *  Documented policy (subset 0.2): the FIRST declared nested state is the
 *  initial state; among the outgoing edges the one with the EARLIEST fire
 *  time wins, ties broken by declaration order; untriggered edges fire at
 *  the current time, `after t` relative to entering the source state, `at T`
 *  at max(now, T). Runs end on a terminal state, at the step budget, or on
 *  a zero-time cycle (Zeno stop) - always deterministically. */
function runStateMachine(
  source: string,
  projection: SysMLProjection,
  targetId: string,
): SysMLRunResult {
  const steps: TraceStep[] = [];
  const env = new Map<string, number>();
  try {
    for (const child of childrenOf(projection, targetId)) {
      if (child.kind !== 'attribute') continue;
      const expr = assignedExpression(source, child.nameSpan.end);
      if (expr === null) {
        return {
          ok: false,
          targetId,
          error: `attribute '${child.name}' has no assigned value`,
          line: child.span.line,
        };
      }
      const value = evaluateExpression(expr, env);
      env.set(child.name, value);
      steps.push({
        index: steps.length,
        description: `${child.name} := ${expr}`,
        value,
        line: child.span.line,
      });
    }
  } catch (error) {
    return {
      ok: false,
      targetId,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const nestedStates = childrenOf(projection, targetId).filter((child) => child.kind === 'state');
  if (nestedStates.length === 0) {
    return { ok: false, targetId, error: 'the state machine has no nested states to execute' };
  }
  const byId = new Map(projection.elements.map((element) => [element.id, element]));
  const scopeIds = descendantsOf(projection, targetId);
  scopeIds.add(targetId);

  const outgoing = new Map<string, TransitionEdge[]>();
  const transitionRelations = projection.relations
    .filter((relation) => relation.kind === 'transitions')
    .sort((a, b) => a.line - b.line);
  for (const relation of transitionRelations) {
    if (!scopeIds.has(relation.from) || !scopeIds.has(relation.to)) continue;
    const trigger = relation.trigger;
    const edge: TransitionEdge = {
      relation,
      fireAt:
        trigger === undefined
          ? (now) => now
          : trigger.kind === 'after'
            ? (_now, enteredAt) => enteredAt + trigger.amount
            : (now) => Math.max(now, trigger.amount),
    };
    const list = outgoing.get(relation.from) ?? [];
    list.push(edge);
    outgoing.set(relation.from, list);
  }

  const pushStep = (description: string, time: number, line?: number) => {
    steps.push({ index: steps.length, description, value: null, time, line });
  };

  // Initial-state rule: first declared nested state in document order.
  let current = nestedStates[0]!;
  let now = 0;
  let enteredAt = 0;
  let sameTimeFires = 0;
  pushStep(`enter ${current.name}`, 0, current.span.line);

  for (let fired = 0; fired < MACHINE_LIMITS.maxTransitions; fired += 1) {
    const candidates = outgoing.get(current.id) ?? [];
    if (candidates.length === 0) {
      // Terminal state: clean completion, nothing left to schedule.
      return { ok: true, targetId, steps, result: null };
    }
    // Earliest-fire selection; candidates are declaration-ordered so a
    // strict `<` keeps the earlier declaration on ties.
    let best: TransitionEdge | null = null;
    let bestFireAt = 0;
    for (const edge of candidates) {
      const fireAt = edge.fireAt(now, enteredAt);
      if (best === null || fireAt < bestFireAt) {
        best = edge;
        bestFireAt = fireAt;
      }
    }
    const chosen = best!;
    if (bestFireAt === now) {
      sameTimeFires += 1;
      if (sameTimeFires > MACHINE_LIMITS.zenoLimit) {
        pushStep(
          `stopped: zero-time transition cycle (Zeno) detected around '${current.name}'`,
          now,
        );
        return { ok: true, targetId, steps, result: null };
      }
    } else {
      sameTimeFires = 0;
    }

    now = bestFireAt;
    const next = byId.get(chosen.relation.to)!;
    const suffix = chosen.relation.trigger ? ` (${describeTrigger(chosen.relation.trigger)})` : '';
    pushStep(`${current.name} → ${next.name}${suffix}`, now, chosen.relation.line);
    current = next;
    enteredAt = now;
  }
  pushStep(`stopped after ${MACHINE_LIMITS.maxTransitions} transitions (step budget)`, now);
  return { ok: true, targetId, steps, result: null };
}

/** Execute one supported target deterministically: actions/calculations
 *  evaluate their attributes in declaration order, each producing a trace
 *  step bound to its source line (calculations report the last computed
 *  value); states step through transitions on a discrete-event clock. */
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
  if (target.kind === 'state') {
    return runStateMachine(source, projection, targetId);
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
