# ADR-0138: SysML v2 Is a Runtime Target and a Pack, Not the Kernel

Date: 2026-10-11  
Status: Proposed  
Related: `docs/adr/0130-execution-target-provider-registry.md`,
`docs/adr/0131-process-execution-provider.md`,
`docs/adr/0132-kernel-runtime-target-family.md`,
`docs/adr/0134-formal-runtime-plugin-packages.md`,
`docs/adr/0135-maintenance-evidence-and-contract-boundaries.md`,
`web/apps/ide/src/sysml/`, `web/apps/ide/src/plugins/builtin/sysml/`

## Context

Reviewing `sysml-harness-kit` prompted a fair question: SysML v2 is
**paradigm-agnostic** (KerML's abstract syntax is small and typed; domain
semantics — state machines, requirements, continuous dynamics — arrive as
libraries, not as kernel grammar), which is structurally the same property this
workbench claims for its shell. Should SysML v2 therefore become LogicPilot's
**kernel**?

Asking that requires naming which kernel is meant, because this repository
already has one and it is not a language:

- ADR-0131: `logicpilot.process.runtime` invokes the real `lpcli`
  compile/run path through `runModelDsl`, and that path is **the sole runtime
  implementation** — providers are adapters, never second simulators.
- ADR-0132: the app-server exposes one execution target id per paradigm family
  (`logicpilot.{process,devs,continuous,agent}.runtime`), all currently routed
  through that same kernel, each **independently replaceable** by a native or
  WASM provider later.
- ADR-0130: `ExecutionTargetRegistry` is the host-owned boundary; a **provider
  registers** a contract-validated target and returns a validated
  run/evidence pair.

So "the kernel" here means the execution/interpreter kernel behind
`runModelDsl`. SysML v2 and KerML are **modeling languages**: they define an
abstract syntax, a textual concrete syntax, view-as-projection, and a model
API. They define **no execution semantics** — simulation requires an external
path. The harness's own survey reaches the same conclusion from the other side:
the standard route to solvers exists (SysPhS, FMI/SSP/DCP/eFMI; the SysML v2 ↔
SSP mapping was still entering a Modelica Association MAP project as of
2026-09-18), and its verdict is "architecturally unobstructed (paradigm-
agnostic), but **the convenience layer is missing**".

## Decision

SysML v2 enters LogicPilot only through extension slots that already exist. It
is never the kernel, and the KerML abstract syntax never becomes the core
document model.

- **As a pack (today).** `logicpilot.sysml` owns its document type, views,
  language service and lowering. SysML views are a **projection** of the model,
  which is the standard's own view philosophy (a diagram is a projection of the
  abstract syntax, not a source of truth).
- **As a runtime target (when a real path exists).** A SysML v2 execution
  target (`logicpilot.sysml.runtime`) joins the ADR-0132 family and is
  registered through ADR-0130 like any other provider — either by lowering
  SysML models to the existing kernel input, or by bridging to an external
  simulation path (SysPhS/FMI-style). It requires **no shell change**: the shell
  already knows no paradigm, and a new family member is exactly what the target
  family was declared for.

## Why not the kernel

1. **It cannot be one.** A kernel with no execution semantics cannot serve as
   the sole runtime implementation (ADR-0131). Making SysML v2 "the kernel"
   would still leave the whole execution, telemetry and evidence loop to be
   built — i.e. the actual product — and would add an interpretation layer in
   front of it.
2. **It collapses the pack seam.** Today a pack contributes a language,
   notation, views, problem sources and a solver. If KerML's meta-model becomes
   the core, every pack must express itself *inside* it, and the pack degrades
   into "a library plus a notation mapping". A continuous-dynamics pack with an
   ODE integrator, or an agent pack with its own scheduling semantics, should
   not have to become a SysML library to be installable.
3. **Governance and cadence.** The standard is still moving on the exact axis
   we would depend on (execution/co-simulation), and its standard library is
   LGPL — the harness's own third-party policy forbids vendoring it. Putting it
   at the core subjects a fast internal design cadence (this ADR is number 138)
   to an external one.
4. **Conformance is not the current bottleneck.** No shipped feature needs
   typed specialization across paradigms yet.

## Recorded honestly: the weakness this question exposes

LogicPilot's shell is paradigm-agnostic **by omission** — `ModelDocument` is
`{nodes, edges}` with `BlockKind = string` and a free-form `params` bag, and
semantics arrive from registered providers. SysML v2 is paradigm-agnostic **by
construction** — a small *typed* core (types, features, specialization) with
domain libraries layered on top. The questioner is right that these are not the
same thing, and the second is the stronger design.

The moment a pack needs **cross-paradigm typed composition** (typed ports and
values flowing between a process block and an agent, say), the free-form core
becomes the limiting factor and a small typed spine earns its keep. KerML is
then the best available reference for that spine's **shape**. That is a
separate decision with its own cost, and it is deliberately not taken here.

## Consequences

- SysML v2 gains a home without the shell gaining knowledge of it; the
  standard's advocates get a target family member and a pack, not a rewrite.
- A SysML v2 execution target is now the natural place to land the "missing
  convenience layer" — a lowering path or an FMI-style bridge — and it can be
  delivered without touching the shell.
## Where an execution target actually binds

A first draft of this ADR claimed this link was undecided. It is not, and the
correction belongs on the record.

- An execution target is declared by a **Node plugin package** — the manifest's
  `executionTargets` plus `execute(request)` exported from its Node entrypoint
  — and registered by `NodePluginRuntime` (`@logicpilot/plugin-catalog`) after
  successful activation, revoked with the plugin's generation (ADR-0134,
  ADR-0135). Activation is transactional: a prepared registry validates first,
  and an owner mismatch (`target.runtime.pluginId`) or a declared target
  without an executable provider fails the whole activation rather than
  installing half a target set. The registry drains before a host transition
  and resumes after. The browser `PluginHost` owns no execution registry on
  purpose; the IDE reads targets from the app server's
  `/api/execution/targets`, which is that same registry over HTTP — so a
  paradigm ships a backend by shipping a Node plugin package, with no shell,
  status-bar or ADR change. The builtin **web** packs declare no targets, which
  is why a browser-only run reports no backend.
- Consequence for SysML v2 specifically: its execution target is a Node
  runtime package, not a new seam. The work is the lowering or bridge inside
  that package.
