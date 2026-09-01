# ADR-0069: Phase 1 Contract Freeze - Language-Neutral JSON Schemas as the Single Source of Truth

Date: 2026-09-01
Status: Accepted
Implements: docs/architecture/next-generation-plugin-platform.md §16 Phase 1（契约冻结）

## Context

The next-generation platform plan (see `docs/architecture/next-generation-plugin-platform.md`)
requires that Plugin Host, Artifact Graph, Knowledge/Diagnostics, Canvas/View and
AgentEngine all be built against frozen contracts before any of them is
implemented in parallel. Without a frozen contract set, parallel workstreams
invent divergent versions of the same envelope (the current codebase already
duplicates tool metadata between client and server, which the plan bans).

Existing precedent in this repo: FlatBuffers schemas `schemas/ir_v2.fbs` and
`schemas/wire.fbs` are frozen with baseline snapshots and a conformance gate
(`scripts/check-schema-conform.ps1`, ADR-0004). The method plugin manifest v1
(`schemas/method_plugin.schema.json`) exists but is only validated implicitly.

## Decision

1. **JSON Schema (draft 2020-12) under `schemas/contracts/` is the single
   source of truth** for the platform contract set:

   | Schema file | Contracts |
   | --- | --- |
   | `common.schema.json` | Shared ids, versions, provenance, free-form JSON payload markers |
   | `plugin-manifest-v2.schema.json` | PluginManifest v2, dependencies, entrypoints, migrations, integrity, `logicpilot.lock` entries |
   | `permission-trust.schema.json` | PermissionId set, TrustLevel T0–T5, grants, trust policy |
   | `artifact-graph.schema.json` | Artifact/Revision/Relation/Transaction and typed-operation envelope |
   | `knowledge-block.schema.json` | KnowledgeBlock types/status/scope, FormulaContent, KnowledgePack |
   | `diagnostic.schema.json` | DiagnosticDefinition/Instance/FixDefinition, stable diagnostic ids |
   | `view-notation.schema.json` | CanvasEngineId, ViewDefinition, NotationPack, CreateAction |
   | `agent-engine.schema.json` | AgentStepRequest/Result, ToolDescriptor, AgentCheckpoint, engine descriptors |
   | `execution-target.schema.json` | ExecutionTarget/Request/Run/Evidence, runtime refs |

   TypeScript and C++ types are **generated** from these schemas
   (`scripts/gen-contracts.mjs`); hand-written code may add behavior but never
   duplicate types. This directly enforces plan rule §17.6 ("插件 schema 是唯一
   事实来源，禁止前后端复制工具表").

2. **Strict object policy.** Every object definition sets
   `additionalProperties: false`, so unknown fields are rejected by validation
   and by the generated C++ parser. Contracts evolve by explicit revision, not
   by silent extension. The two free-form payload carriers
   (`JsonSchemaFragment`, `JsonValue`, marked `x-freeform-json`) are the only
   escape hatches and are reserved for opaque, plugin-owned structured data.

3. **Version checks are contract fields.** Versioned payloads carry a `schema`
   const (e.g. `logicpilot.plugin-manifest/v2`) plus a `contractVersion` const.
   The generated parsers enforce both; the host additionally gates
   `apiVersion` against `SUPPORTED_PLUGIN_API_VERSIONS` (currently `[1]`).

4. **The generator subset is deliberately small** (named object defs, string
   enums, consts, arrays, maps, free-form markers). Inline nested objects are
   forbidden in contracts; this keeps C++ emission deterministic and the
   round-trip property checkable.

5. **Baseline + compatibility gate.** `schemas/contracts/baseline/` snapshots
   the frozen schemas; `node scripts/check-contract-conform.mjs` fails on
   removed definitions/properties, new required fields, type changes, and any
   enum set change, and audits the strict-object policy. Updating the baseline
   is an explicit reviewed act performed in the same commit as the contract
   change (same workflow as ADR-0004's FlatBuffers freeze).

6. **Gate tests.** Both stacks must pass the same four gates:
   round-trip, unknown-field rejection, version checks, and dependency-cycle
   detection (`resolveActivationOrder` TS / `resolve_activation_order` C++),
   plus full JSON Schema validation via ajv (TS) for patterns/bounds that the
   minimal C++ parser intentionally does not enforce.

## Consequences

- Phase 2+ workstreams (Plugin Host, Artifact Graph, Knowledge, Canvas,
  AgentEngine) can proceed in parallel against these contracts.
- C++ contract support adds a compile-time dependency on nlohmann::ordered_json
  (already a kernel dependency) — no new vcpkg packages.
- The `@logicpilot/contracts` workspace package becomes the import point for
  any frontend code touching platform envelopes; paradigm code should not
  import it directly until Phase 2+ wiring lands.
- Free-form payloads (`JsonValue`) are opaque to the shell by design;
  interpreters live in plugin land and arrive in later phases.

## Gate evidence

- `node scripts/check-contract-conform.mjs` — 9 schemas, 83 definitions conform to baseline.
- `pnpm --filter @logicpilot/contracts test` — 16 vitest cases: round-trip /
  unknown-field / version / dependency-cycle gates plus ajv schema validation.
- `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test` — 504/504 CTest
  cases pass (496 baseline + 8 contract gates in
  `kernel/tests/test_contracts.cpp`).
- IDE regression: 344 passed / 1 conditional skip (unchanged from baseline);
  lint 0 errors; prettier clean; workspace typecheck clean.
