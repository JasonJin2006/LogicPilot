# ADR-0068: Paradigm Plugins - Removable Method Units with a Neutral Core

Date: 2026-08-25
Status: Accepted (partially implemented; see "Migration status")

## Context

LogicPilot bundles several modeling paradigms (DES/process, statechart,
agent, system dynamics, DEVS, SysML projection). They were wired into both
the C++ drivers and the IDE bundle unconditionally:

- Kernel: every method library linked through a hardcoded aggregate
  (`methods/register.cpp`), no per-method build switch.
- Frontend: paradigm directories (`src/model`, `src/sysml`) registered into
  workbench registries via scattered side-effect imports; the DSL document
  type was even registered inline inside the platform core
  (`workbench/documentTypes.ts`); platform modules imported paradigm stores
  directly (panels focus probe, problems aggregation).

The product goal is a plugin economy: paradigms can be removed, swapped or
packaged without forking the core, and third parties can add methods.

## Decision

1. **Plugin = self-contained unit + explicit composition root.**
   - Frontend: `web/apps/ide/src/plugins/` is the only place allowed to
     import paradigm modules. Each paradigm contributes exclusively through
     the platform registries (documentTypes, diagnostics, palette, outline,
     panels). `App.tsx` imports `./plugins` first; removing a paradigm is
     deleting one line plus its directory.
   - Kernel: each built-in method gains a `LOGICPILOT_METHOD_<NAME>` CMake
     option (default ON). The option gates the subdirectory, the aggregate
     link, and an `LP_WITH_METHOD_<NAME>` define that guards the
     registration call in `methods/register.cpp`. A driver linked against a
     pruned aggregate registers fewer methods; models requesting a disabled
     method fail at run time with KR1004 ("no registered method runtime"),
     which already exists and is tested.

2. **The registry seam stays exactly as designed** (ADR-0009, method-runtime
   spec): `SimulationMethod` lifecycle + `MethodRegistry` singleton +
   IR-driven dispatch (`SemanticsRef.library`). Pluginization does not
   invent a new ABI for linked plugins; the existing dynamic seams
   (C-ABI `lp_method_plugin_v1`, WASM manifests, ADR-0055) remain the path
   for out-of-process plugins.

3. **Boundary enforcement over convention**: eslint
   `no-restricted-imports` forbids `workbench/**` from importing
   `src/sysml/**` or `src/model/**` (the rule the HANDOVER previously
   stated but nothing enforced).

## Non-goals / honest limitations

- **DEVS toggle comes after the drivers decide what a devs-less CLI means.**
  Since 2026-08-25 the DEVS engine is an ordinary `logicpilot_method_devs`
  target and the neutral interface no longer names DEVS types
  (checkpoint seam is capability-based; replication framework and the IR
  reader are core-owned). The remaining `LOGICPILOT_METHOD_DEVS=OFF` work
  is a product decision: lpcli's `--model built-in:mm1` registry and the
  server's default demo path assume DEVS, so pruning it needs explicit
  driver-level fallbacks first.
- Platform layers outside `workbench/**` still import paradigm modules
  (`layout/panels.tsx` focus probe, `ai/assistantRuntime.ts`,
  `project/dslOutlineContribution.tsx`, ...). These are migrated
  incrementally behind the same registries; the lint scope grows with each
  migration.
- Runtime hot-plug (dlopen at process start from a plugin directory) is NOT
  a goal; packaging means separate libraries/packages composed at build
  time, consistent with ADR-0003 (minimal dependency set) and ADR-0007
  (conservative first).

## Migration status (2026-08-25)

| Step | State |
| --- | --- |
| Per-method CMake options + guarded aggregate | done (all-ON gate green; pruned combo verified in `build/plugin-check`) |
| Frontend `plugins/` composition root (des, sysml) | done |
| DSL document type moved out of workbench core | done |
| `workbench/**` boundary lint rule | done (0 violations) |
| panels focus probe routed through panel registry | open |
| ai/run/project/layout de-paradigmatization + wider lint scope | open |
| Replication framework + IR reader relocated under `runtime/` (forwarders keep old paths) | done (2026-08-25) |
| `DevsCheckpoint` removed from SimulationMethod; legacy session checkpoint moved to `devs/session_checkpoint.h` capability helpers | done (2026-08-25) |
| `logicpilot_phase1b` dissolved; DEVS engine is its own `logicpilot_method_devs` target; neutral impls (ir_loader, replication framework, agent ECS store) absorbed by the core target | done (2026-08-25) |
| Core no longer auto-registers any method (`register_builtin_methods()` decl left runtime headers; drivers/tests register via `methods/register.cpp`) | done (2026-08-25) |
| File-path relocation of devs sources into `methods/devs/` + renaming the `logicpilot_phase1b_tests` executable | open (cosmetic) |
| `built-in:mm1` registry removed from lpcli; drivers require explicit `--model-file`/`--project` | done (2026-08-25) |
| `LOGICPILOT_METHOD_DEVS` registration-level toggle (KR1004 when OFF) | done (2026-08-25) |
| Engine rehoming: `QueueingFlowSim` impl -> `methods/process/queueing_flow_sim.cpp` (streaming gateway now links the process plugin); `ir_agent.cpp` (`AgentReplicationModel`) -> `methods/agent`; `Mm1Simulator` -> `logicpilot_test_models` fixture lib | done (2026-08-25) |
| Target-level `LOGICPILOT_METHOD_DEVS=OFF`: the library is not built; lp-server / serve subcommand / DEVS test executables are skipped (they hard-require it); neutral ExpressionEvaluator + logical-trace archive store moved into the core target | done (2026-08-25) |
| Verified pruning combo: `LOGICPILOT_METHOD_DEVS=OFF` + `LOGICPILOT_METHOD_SD=OFF` (the SD runtime still composes `ContinuousReplicationModel`, hosted by the devs target until its own rehoming) configures, builds lpcli+dsl+agent/process/statechart and links clean | done (2026-08-25) |
| `ContinuousReplicationModel` rehoming -> sd domain, unlocking DEVS-only pruning without touching SD | open |
| `DevsEvidenceRecorder` parameter on `SimulationSession::start` re-hosted behind a neutral evidence seam | open |

## Consequences

- Drivers and tests keep calling `register_all_methods()`; nothing changes
  when all options are ON (default builds are bit-for-bit equivalent in
  behavior).
- Removing a method shrinks lpcli/lp-server and removes its palette/
  validators on the frontend only if the corresponding frontend plugin is
  removed too - the two sides degrade independently and safely (KR1004 /
  missing editor panel falls back to text editor).
