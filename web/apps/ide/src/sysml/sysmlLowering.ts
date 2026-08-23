// SysML → LogicPilot DSL lowering for state machines
// (workbench-architecture-plan.md §8 S2: execution targets may select a
// "lowering backend"). Compilation happens C++-side and the frontend only
// reads/writes DSL, so lowering means generating equivalent .lp statechart
// source and letting the existing lp-server pipeline run it on
// StatechartRuntime - full telemetry, pause/stop and checkpoints for free.
//
// Stable diagnostic codes (documented table):
//   SL0001 error   target is not a state definition with states
//   SL0002 error   nested sub-states are outside the lowering subset
//   SL0003 error   absolute-time trigger ('at T'): statechart timers are
//                  relative to state entry, so the lowering would change
//                  semantics
//   SL0004 error   trigger-less transition: kernel semantics need a trigger
//   SL0005 error   unknown time unit on a trigger
//   SL0006 error   transition endpoints leave the machine scope
//
// Any diagnostic above is an ERROR on purpose: dropping or guessing would
// produce a machine that is not equivalent to the SysML source (plan §13).

import { parseDsl } from '@logicpilot/editor';
import type { SysMLElement, SysMLProjection, SysMLRelation } from './sysmlProjection';

export interface LoweringDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  line?: number;
}

export interface LoweringResult {
  /** False when the machine cannot be lowered faithfully; `dsl` is empty. */
  ok: boolean;
  modelName: string;
  dsl: string;
  entryState: string | null;
  diagnostics: LoweringDiagnostic[];
}

const TIME_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  ms: 0.001,
  min: 60,
  h: 3600,
};

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function isStateChild(element: SysMLElement): boolean {
  return element.kind === 'state';
}

export function lowerStateMachine(
  source: string,
  projection: SysMLProjection,
  targetId: string,
): LoweringResult {
  void source;
  const diagnostics: LoweringDiagnostic[] = [];
  const fail = (dsl = ''): LoweringResult => ({
    ok: false,
    modelName: '',
    dsl,
    entryState: null,
    diagnostics,
  });

  const target = projection.elements.find((element) => element.id === targetId);
  if (target === undefined || target.kind !== 'state' || target.declaration !== 'definition') {
    diagnostics.push({
      code: 'SL0001',
      severity: 'error',
      message: 'lowering target must be a `state def` element',
    });
    return fail();
  }

  const states = projection.elements.filter(
    (element) => element.ownerId === target.id && isStateChild(element),
  );
  if (states.length === 0) {
    diagnostics.push({
      code: 'SL0001',
      severity: 'error',
      message: `state machine '${target.name}' declares no states`,
      line: target.span.line,
    });
    return fail();
  }

  // Nested sub-states would need hierarchical statechart semantics the flat
  // kernel machine does not express - refuse instead of flattening silently.
  const nested = states.filter(
    (state) => projection.elements.some((child) => child.ownerId === state.id),
  );
  if (nested.length > 0) {
    diagnostics.push({
      code: 'SL0002',
      severity: 'error',
      message:
        `nested sub-states inside ${nested
          .map((state) => `'${state.name}'`)
          .join(', ')} are outside the lowering subset`,
    });
    return fail();
  }

  const stateIds = new Set(states.map((state) => state.id));
  const transitions = projection.relations.filter(
    (relation: SysMLRelation) =>
      relation.kind === 'transitions' && stateIds.has(relation.from),
  );

  const stateLines = states.map((state) => `    state ${state.name} { }`);
  const transitionLines: string[] = [];
  for (const relation of transitions) {
    const line = (line: number | undefined) => ({ line });
    if (!stateIds.has(relation.to)) {
      diagnostics.push({
        code: 'SL0006',
        severity: 'error',
        message: `transition from '${relation.from}' leaves the machine scope`,
        ...line(relation.line),
      });
      continue;
    }
    const fromState = states.find((state) => state.id === relation.from)!;
    const toState = states.find((state) => state.id === relation.to)!;
    const trigger = relation.trigger;
    if (trigger === undefined) {
      diagnostics.push({
        code: 'SL0004',
        severity: 'error',
        message: `transition '${fromState.name}' → '${toState.name}' has no trigger; the kernel statechart needs one`,
        ...line(relation.line),
      });
      continue;
    }
    if (trigger.kind === 'at') {
      diagnostics.push({
        code: 'SL0003',
        severity: 'error',
        message: `absolute time trigger ('at ${trigger.amount}') on '${fromState.name}' → '${toState.name}' cannot be expressed: statechart timers are relative to state entry`,
        ...line(relation.line),
      });
      continue;
    }
    const unit = trigger.unit ?? 's';
    const factor = TIME_UNIT_SECONDS[unit];
    if (factor === undefined) {
      diagnostics.push({
        code: 'SL0005',
        severity: 'error',
        message: `unknown time unit '${unit}' on '${fromState.name}' → '${toState.name}'`,
        ...line(relation.line),
      });
      continue;
    }
    const seconds = trigger.amount * factor;
    transitionLines.push(
      `    transition ${fromState.name}_${toState.name} { from = ${fromState.name}; to = ${toState.name}; triggeredBy = timeout; timeout = ${formatSeconds(seconds)} }`,
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return fail();
  }

  const entryState = states[0]!.name;
  const modelName = `Lowered_${target.name}`;
  const dsl = [
    `model ${modelName} {`,
    `  statechart ${target.name} {`,
    `    initial = ${entryState}`,
    ...stateLines,
    ...transitionLines,
    '  }',
    '}',
    '',
  ].join('\n');

  // Defensive self-check: generated source must parse before it leaves here.
  const parsed = parseDsl(dsl);
  if (!parsed.ok) {
    diagnostics.push({
      code: 'SL0007',
      severity: 'error',
      message: `internal: generated DSL failed to parse: ${parsed.error ?? 'unknown'}`,
    });
    return fail();
  }

  return { ok: true, modelName, dsl, entryState, diagnostics };
}

/** Where a lowered artifact lives inside a project. Deliberately OUTSIDE
 *  `model/` so the sync engine never mistakes it for a model-part fragment -
 *  it is a complete standalone model, not a fragment of the parent. */
export function loweredDslPath(modelName: string): string {
  return `generated/${modelName}.lp`;
}
