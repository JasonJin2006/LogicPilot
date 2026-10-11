// Pure derivations for the status bar's paradigm and backend slots.
//
// Both slots report what the model and the runtime declare about themselves,
// so the shell never names a paradigm: the paradigm slot echoes the model's
// own `use <pack>` declaration (adding a pack lights it up with no edit
// here), and the backend slot follows the execution targets the app server
// reports. A slot with nothing to report returns null and is not rendered.

import type { ModelDocument } from '@logicpilot/editor';

/** The libraries a model declares for itself (`use <name>`), in document
 *  order, de-duplicated. The DSL keeps each declaration as a node, so this
 *  reads the parsed model rather than re-scanning the source text. */
export function declaredLibraries(document: Pick<ModelDocument, 'nodes'>): string[] {
  const names: string[] = [];
  for (const node of document.nodes) {
    if (node.kind !== 'use' || names.includes(node.name)) continue;
    names.push(node.name);
  }
  return names;
}

/** The backend (execution target) label to report.
 *
 *  The runtime registers one target per paradigm family (ADR-0132), so a real
 *  desktop workspace normally offers several and none has been chosen yet.
 *  Reporting nothing in that case would leave the slot permanently blank in
 *  the common case, so an ambiguous set reports its size: the slot then says
 *  what this workspace can run on, and the Run dialog is where one gets
 *  picked. A run's own target always wins - that one is the backend in use. */
export function backendLabel(
  sessionTargetId: string | null,
  availableTargetIds: readonly string[],
): string | null {
  if (sessionTargetId !== null) return sessionTargetId;
  if (availableTargetIds.length === 0) return null;
  if (availableTargetIds.length === 1) return availableTargetIds[0]!;
  return `${availableTargetIds.length} targets`;
}
