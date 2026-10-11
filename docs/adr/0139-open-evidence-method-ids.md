# ADR-0139: Execution Evidence Method Ids Are Open

Date: 2026-10-11  
Status: Accepted  
Related: `schemas/contracts/execution-target.schema.json`,
`docs/adr/0130-execution-target-provider-registry.md`,
`docs/adr/0132-kernel-runtime-target-family.md`,
`docs/adr/0134-formal-runtime-plugin-packages.md`,
`docs/adr/0138-sysml-as-runtime-target.md`,
`docs/specs/dsl-freeze.md` section 3

## Context

`ExecutionEvidence` enumerated its method names in four closed sets:

```json
"methods":     { "items": { "enum": ["process", "devs", "continuous", "agent"] } }
"runtimeKind": { "enum": ["process", "devs", "continuous", "agent"] }
"method":      { "enum": ["process", "devs", "sd", "agent"] }
"details.kind": { "enum": ["process", "devs", "continuous", "agent"] }
```

This contradicts the platform's own rule. Everything else was made pluggable on
purpose: a paradigm contributes its language, notation, views, palette and
execution targets through its own package (ADR-0134), the shell holds no
paradigm vocabulary, and a new paradigm pack needs no shell change. Evidence
was the one place where the opposite was true - **shipping a new paradigm
required editing the contract and regenerating it**, which is exactly what
ADR-0132's per-family target design was meant to avoid.

The same four lines also carry a naming problem worth recording. Three
different things are called a "kind" around evidence:

- `runtimeKind` on evidence holds a **paradigm family** name.
- `method` holds a **kernel method** name, where `continuous` is spelled `sd`
  (`scripts/runtime-adapters.mjs` maps `continuous -> sd`). So the two fields
  are not the same vocabulary even though both look like paradigm names.
- `$defs.RuntimeKind` holds a **host mechanism**: `interpreter`, `wasm`,
  `native`, `external`.

### The closed set was already losing a real method

This was not a hypothetical. The runtime entrypoint
(`plugins/runtime/entrypoint.mjs`) filtered the kernel's method summary against
the same four names before writing evidence, so anything else was dropped
silently. Asking the real kernel what it reports for a generic run:

```
runtimeKind= generic  result.methods= ["process","agent","statechart","sd","devs"]
```

`statechart` is a method this repository already ships a paradigm pack for
(`logicpilot.statechart`), and its evidence was being **dropped on the floor** -
the run filed `["process","agent","continuous","devs"]`, quietly under-reporting
what it had executed. The closed enum and the closed filter were the same bug
seen from two ends.

## Decision

Add `$defs.MethodId` and point all four properties at it:

```json
"MethodId": {
  "type": "string",
  "pattern": "^[a-z][a-z0-9._-]*$",
  "minLength": 1,
  "maxLength": 64
}
```

The id is validated as **an id**, not as membership of a list. A paradigm
contributes evidence under its own name; the contract does not need to know
that name in advance. `contractVersion` stays `1`.

### Why no version bump

- Every existing producer already emits conforming ids, so archived evidence and
  the wire format stay valid; the only observable difference is that an id the
  contract has never heard of is now accepted instead of rejected. That is a
  widening, in the direction that lets new packs work.
- Readers were checked for exhaustive switching: `ExecutionTargetRegistry`
  compares `details.kind !== runtimeKind` (a comparison, still valid), and no
  TypeScript consumer switches on these fields. The C++ strict parser is
  regenerated from the same schema in the same commit.
- The gate flags it. `scripts/check-contract-conform.mjs` counts enum widening as
  breaking because readers may switch exhaustively, which is the conservative
  and correct default. The documented way to accept such a change is to copy the
  schema into `schemas/contracts/baseline/` in the same commit, which is what
  this change does.

### Deliberately not changed

- **`RuntimeKind` stays closed** (`interpreter` / `wasm` / `native` /
  `external`). Those are mechanisms the host implements, not paradigm
  vocabulary; adding one is a real change of host capability, so requiring a
  contract change is right.
- **`runtimeKind` and `method` are not renamed.** Renaming or removing a
  property is breaking and would touch every producer, including the Node
  runtime packages that emit evidence today. Recorded here so the next reader
  does not repeat the investigation; a rename is its own decision.

## Consequences

- A new paradigm files evidence under its own method id without touching the
  contract, the shell, or the status bar.
- **Generic-run evidence gains `statechart`**, which it was silently losing
  before. That is a correctness fix, not just a hygiene one: the evidence now
  names every method the run actually executed.
- The producer no longer filters, so a method name the kernel reports with an
  invalid shape reaches the contract validator and **fails loudly** instead of
  shrinking the evidence quietly. A failure that names the payload is worth more
  than evidence that is subtly incomplete.
- Id shape is still enforced: `runtimeKind: "Process Family"` and
  `methods: ["Process"]` are rejected (`web/packages/contracts/test/contracts.test.ts`).
- Harness scripts still keep their own lists of what this build ships:
  `web/apps/ide/scripts/plugin-catalog-bridge.mjs` validates the kernel call's
  `runtimeKind` against a literal set, and
  `web/apps/ide/scripts/ai-endpoint.mjs` maps family names to target ids. Those
  are deployment facts of a particular checkout rather than contract vocabulary.
  `scripts/runtime-adapters.mjs` already exports `runtimeAdapterIds()` if the
  first one is ever derived instead of listed.
- Note for anyone touching a bundled consumer: the generated schema is embedded
  in `@logicpilot/plugin-catalog`'s `dist/index.bundle.js`, so a contract change
  needs that package rebuilt or the stale validator will reject the new payload.

### Scope limit, corrected on review

A first draft of this ADR claimed that "a new paradigm pack needs no shell
change" had **no remaining counterexample in the contract surface**. That is too
strong, and the correction is kept here deliberately. Evidence's method ids are
open now, but the same class of closed enumeration still exists elsewhere:

- `view-notation.schema.json`'s `CanvasEngineId` mixes mechanism ids
  (`graph2d`, `scene3d`, `table`, `chart`, `text`) with paradigm/notation names
  (`flow`, `statechart`, `sequence`, `stock-flow`, `causal-loop`). A paradigm
  shipping its own canvas engine still has to change the contract.
- `model/blockDefs.ts` hardcodes the seven palette libraries, and
  `layout/PalettePanel.tsx` defaults to `library ?? 'process'` in three places.

This ADR therefore closes **the evidence surface only**. It is one instance of a
pattern, not the end of it, and the pattern has no mechanical gate behind it yet
(see `docs/specs/ide-layout.md` §7).

## Verification

- `node scripts/gen-contracts.mjs`: `MethodId` generated, four properties now
  typed `MethodId`; `export type MethodId = string`.
- `node scripts/check-contract-conform.mjs`: conformant against the updated
  baseline (129 definitions).
- `@logicpilot/contracts` tests: 22 passing, including the two added for this
  decision (an unlisted method id is accepted, a non-id is still rejected).
- `node scripts/test-node-runtime-e2e.mjs`: PASS. This is the check that matters
  for the producer: it runs a real kernel execution through the real target
  registry, so the evidence is validated by the live contract.
- Kernel methods for `examples/mm1.lp`, read straight from the built binary:
  `{"methods":["process"]}`.
