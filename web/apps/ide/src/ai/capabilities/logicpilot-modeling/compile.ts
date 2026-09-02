// Compiler/preflight service for the LogicPilot modeling capability.

import { generateDsl } from '@logicpilot/editor';
import { aiValidateDsl } from '../../api';
import type { AssistantSessionState } from '../../assistantTypes';
import { diagnoseDocument } from '../../../workbench/diagnostics';
import { useModelStore } from '../../../state/modelStore';

export async function compileCurrent(
  session: AssistantSessionState,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  phase: 'preflight' | 'compiler';
  diagnostics: Array<{
    code: string;
    message: string;
    severity?: 'error' | 'warning';
    source?: 'preflight' | 'compiler';
  }>;
}> {
  const document = useModelStore.getState().document;
  const dsl = generateDsl(document);
  session.dsl = dsl;
  const preflight = diagnoseDocument('dsl', document).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    // Compiler diagnostics have no 'info' lane; informational findings do
    // not block and surface as warnings.
    severity: diagnostic.severity === 'info' ? ('warning' as const) : diagnostic.severity,
    source: 'preflight' as const,
  }));
  if (preflight.some((diagnostic) => diagnostic.severity === 'error')) {
    session.diagnostics = preflight;
    session.compiled = false;
    return { ok: false, phase: 'preflight', diagnostics: preflight };
  }
  const result = await aiValidateDsl(dsl, signal);
  const diagnostics = [...preflight, ...result.diagnostics];
  session.diagnostics = diagnostics;
  session.compiled = result.ok;
  return { ok: result.ok, phase: 'compiler', diagnostics };
}
