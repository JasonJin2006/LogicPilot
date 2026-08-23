# ADR-0067: Evidence Presentation as an AI Capability

- **Status**: Proposal (awaiting review — design doc only, no code yet)
- **Date**: 2026-08-24
- **Deciders**: LogicPilot AI panel UX review (user direction)

## Context

The AI panel renders "one-shot" results — DES block statistics, parameter
sweeps, optimization charts, causal evidence, before/after comparisons,
generated DSL and run logs — as hardcoded `ai-result` blocks (tables, chart
components, `details` sections) that only the legacy quick-action path can
produce. The user direction (UX audit §4): evidence results must NOT be
hardcoded into the chat UI; the assistant must be able to *actively present*
evidence when it decides it is relevant — analogous to how an AI assistant
can render a mermaid diagram on request.

Goals:

1. The assistant decides when to present evidence, and the panel renders it
   as a typed card inside the conversation turn (aligned with B1/C1).
2. New evidence kinds (charts, tables, diagrams, DSL previews) are added by
   registering a renderer, not by editing the conversation renderer.
3. The legacy quick-action path keeps working; it can reuse the same
   renderers internally.

Non-goals (this ADR): replacing the legacy quick-action buttons, persisting
rendered artifacts (they remain derived from turn data), and any kernel or
simulation changes.

## Decision

### 1. Evidence is produced through an assistant tool

Add a server-side assistant tool `present_evidence` to the LogicPilot
modeling capability's tool catalog (`ASSISTANT_TOOLS` in
`scripts/ai-assistant.mjs` / `agent-skills.mjs`):

```jsonc
{
  "name": "present_evidence",
  "description": "Render evidence inside the conversation (block stats, charts, comparisons, diagrams). Call it after producing or querying results; do not invent numbers — pass exactly the data the tools returned.",
  "parameters": {
    "type": "object",
    "properties": {
      "kind": { "type": "string", "enum": ["block-stats", "trajectory", "sweep", "optimization", "explain", "comparison", "dsl", "mermaid"] },
      "title": { "type": "string" },
      "payload": { "type": "object" }
    },
    "required": ["kind", "payload"]
  }
}
```

The server validates the payload minimally (kind known, payload object, size
cap) and **passes it through**; it does not interpret kinds, so new kinds do
not need server changes beyond the enum.

### 2. The runtime carries an `evidence` step

`AssistantStepRecord` (web/apps/ide/src/ai/assistantRuntime.ts) gains a step
kind:

```ts
{ kind: 'evidence', label: string, kindName: string, artifact: unknown }
```

`runAssistant` records the step when the provider requests the tool — the
same path as existing tool-result steps — so `present_evidence` calls appear
in the turn's `steps`, are visible in the activity trail, and are replayed
from `kernelEvents` exactly like other steps.

### 3. The panel renders evidence through a renderer registry

A new module `web/apps/ide/src/ai/evidenceRenderers.ts`:

```ts
export interface EvidenceRenderer {
  render(artifact: unknown): ReactNode;
}
export const evidenceRenderers: Record<string, EvidenceRenderer> = {
  'block-stats': { render: BlockStatsCard },
  'trajectory': { render: TrajectoryCard },
  'sweep': { render: SweepCard },
  'optimization': { render: OptimizationCard },
  'explain': { render: ExplainCard },
  'comparison': { render: ComparisonCard },
  'dsl': { render: DslCard },
  'mermaid': { render: MermaidCard },
};
```

- The conversation renderer iterates `turn.assistantRecord.steps`; an
  `evidence` step renders `<EvidenceCard step={step} />`, which dispatches
  through the registry and falls back to a "未知证据类型" card.
- Existing `ai-result` markup (block table, `OptimizeChart`,
  `TrajectoryChart`, parameter-variation table, explain evidence, comparison
  tables) is extracted **by moving** the JSX/components into the registry —
  no copied logic. The legacy quick-action path imports the same components,
  so both paths stay in sync by construction.

### 4. Presentation is the AI's choice; data stays honest

- The tool contract says: never fabricate numbers; only pass values returned
  by the actual modeling tools (`run`, `sweep`, `optimize`, `explain`,
  `compare`) that the assistant executed in this turn.
- Chat-only answers (no tool calls) render no evidence — the card only
  appears when the assistant explicitly presents it, so a "soft" answer never
  fakes a chart.

## Consequences

- Positive: evidence becomes a first-class dynamic capability; new evidence
  kinds are one renderer + one enum entry; the AI can (and is guided to)
  explain results in prose plus present a chart when it helps.
- Positive: legacy quick actions shrink to thin wrappers around the same
  renderers (later slice, not included here).
- Negative/risk: `present_evidence` is a client-visual tool executed
  server-side — the server must not treat its output as authoritative (it is
  presentation data only); turn validation must accept the new step kind
  (kernel event transcript schema is additive; frozen contracts in
  `ir_v2.fbs`/`wire.fbs` are untouched).
- Negative: model/provider context grows slightly per call; mitigate by a
  size cap on the payload (e.g. 32 KiB, counts capped by the caller).

## Follow-up slices (when approved)

1. Runtime + tool catalog: `present_evidence` tool, `evidence` step,
   server pass-through validation, runtime tests.
2. Renderer registry + move existing `ai-result` JSX into it; render evidence
   steps inside turns; keep legacy path importing the same components.
3. Mermaid renderer (client-side, sanitized, no network fetch — same policy
   as the rest of the IDE CSP); `dsl` card reuses the existing DSL scroll.
4. Optional: quick-action results become `evidence` steps so `/optimize`
   etc. show up in the turn trail with their cards.
