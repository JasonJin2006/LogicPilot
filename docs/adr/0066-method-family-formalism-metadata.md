# ADR 0066: Method family and formalism metadata

Status: **implemented as transitional runtime metadata; taxonomy superseded in
part by the Workbench architecture plan (2026-08-23)**.

## Context

The registry previously treated `process`, `statechart`, `agent`, `sd`, and
kernel-native `devs` as a flat list of methods. That made the code structure
look like Process was a top-level modeling family rather than a discrete-event
formalism/library.

## Decision

`MethodRegistry::Descriptor` now carries two orthogonal classifications:

- family: `discrete_event`, `agent`, or `system_dynamics`;
- formalism: `devs`, `process`, `statechart`, `agent`, or `sd`.

These fields classify existing **runtime adapters** only. They are not the
universal modeling ontology: `process` currently labels the legacy ProcessFlow
adapter, Statechart is an embeddable behavior formalism, Agent is a modeling
worldview, and SysML/C4 document types do not belong in `MethodRegistry`.
Executable SysML elements may still create explicit execution targets backed by
a registered interpreter, lowering backend, or external adapter. The target separation
of document/library/formalism/runtime/execution-policy is defined in
[`../workbench-architecture-plan.md`](../workbench-architecture-plan.md).

Existing IR `SemanticsRef.library` values remain unchanged. Built-ins and
linked method plugins register explicit mappings; old third-party manifests
without the optional fields remain loadable as `unknown`. Manifest fields are
validated when present. The DEVS checkpoint entry point in
`SimulationSession` identifies the DEVS formalism through registry metadata,
not the literal method name.

Directory movement and IR schema changes are intentionally deferred until the
metadata has propagated through coordination and tooling.

## Consequences

- Existing Process and Statechart runtime adapters are visibly grouped with
  discrete-event execution for compatibility; this does not make Process a
  top-level formalism or force every Statechart to use that runtime.
- Capability flags still decide execution scheduling; family/formalism now
  provide stable semantic context for diagnostics and future coordination.
- Existing `library="process"` models and two-field plugin descriptors remain
  source-compatible.
