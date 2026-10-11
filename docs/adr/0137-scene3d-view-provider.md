# ADR-0137: 3D Scene as a Paradigm-Agnostic View Provider

Date: 2026-10-11
Status: Proposed
Related: `web/packages/scene3d/`, `web/apps/ide/src/plugins/builtin/scene3d/`,
`web/apps/ide/src/plugins/viewPlanner.ts`

## Context

The 3D scene capability (`@logicpilot/scene3d` plus the `logicpilot.scene3d`
plugin) ships in the same change set as the formal runtime plugin packages. It
was read by a reviewer as "a new paradigm", or as "a panel for one particular
paradigm". Neither is correct, and the ambiguity is worth resolving in writing:
the workbench skeleton must stay paradigm-agnostic. The shell provides slots;
every paradigm, panel, notation and language is supplied by an extension.

## Decision

The 3D scene is a **paradigm-agnostic view provider**, not a paradigm.

- The plugin manifest declares `"requires": []`, no permissions and
  `trust: t0`; its description states it "owns no paradigm". It activates in a
  zero-paradigm build.
- It contributes exactly one declarative **view** (`logicpilot.view.scene3d`)
  against a neutral canvas type (`scene3d`), sourced from `model-document` and
  bound to `semantic-model` / `run` / `evidence` artifacts. It declares no
  palette, notation, create action, diagnostic or tool.
- The rendering kernel `@logicpilot/scene3d` is pure and renderer-free. It
  consumes the editor's `ModelDocument` and telemetry; an unknown block kind is
  a first-class result (generic shape), never an assumption.
- Paradigm-specific knowledge belongs to the paradigm packages and to the
  telemetry projector seam
  (`web/apps/ide/src/plugins/builtin/telemetryProjectors.ts`), not to the scene
  kernel.
- A panel is a dock slot; a view is what fills it. The scene plugin owns the
  view; panels stay generic hosts.

## Known paradigm leaks (to be closed)

Three places in the current kernel still carry paradigm-specific vocabulary.
All three are already recorded in the package README as known boundaries:

1. `sceneModel.ts` `KIND_VISUALS` — a visual-interest table naming process
   kinds (queue, source, sink, moveTo, action, ...). Unknown kinds fall back to
   a generic box, so it is a default mapping, not a hard dependency.
2. `spatialGraph.ts` — reads process-style spatial markers (`node` / `path`),
   mirroring `methods/process/process_flow.cpp`.
3. `motion.ts` — agent placement assumes the queue ↔ server anchor pair. Other
   paradigms (statechart, system dynamics) need their own mappings; none exist.

## Shell coupling (to be closed)

The `scene3d` panel is currently a **shell panel**, registered by name in
`layout/panels.tsx` and branched by name in `layout/Workspace.tsx` (the "Scene"
tab, the "View the model in 3D" action, and the centre-empty predicate).
Removing the plugin removes the view contribution, but the shell still knows
the panel id. For true plug-and-play, the shell must treat `scene3d` as any
other registered view/canvas instead of special-casing its name.

## Consequences

- The 3D scene can be added or removed as one extension without touching any
  paradigm package, and it works before any paradigm is installed.
- A new paradigm gets real-time 3D only by adding its own projector/motion
  mapping behind the existing seam; it never forks the scene kernel.
- Closing the three leaks and the shell coupling is a follow-up, not a
  precondition. Until then the capability is neutral in composition but not yet
  neutral in every default mapping.

## Rejected alternatives

- **Make the 3D scene a paradigm.** It has no semantics, no execution and no
  language; it only projects a document that other paradigms produce.
- **Give each paradigm its own 3D panel.** Panels are shell slots, not paradigm
  surfaces; the view registry already exists to avoid exactly this.
- **Bake queue/server/process vocabulary into the scene kernel as the model.**
  That would make the kernel wrong for every other paradigm and contradict the
  zero-paradigm build guarantee.
- **Leave the shell's by-name `scene3d` branches as "just a panel".** That is
  the coupling this ADR exists to prevent from hardening.
