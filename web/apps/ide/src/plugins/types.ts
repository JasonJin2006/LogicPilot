// Plugin contract (ADR-0068): a paradigm ships as a self-contained unit that
// contributes to the workbench exclusively through the platform registries
// (documentTypes, diagnostics, palette, outline, panels). The IDE core never
// imports paradigm directories; plugins are wired only in ./index.ts.

export interface LogicPilotPlugin {
  /** Stable registry id, namespaced ('logicpilot.<paradigm>'). */
  id: string;
  description: string;
}
