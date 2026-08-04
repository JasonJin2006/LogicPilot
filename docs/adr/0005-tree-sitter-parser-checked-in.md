# ADR-0005: Tree-sitter Grammar `parser.c` Checked In (Zero Build-Time CLI Dependency)

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

The DSL frontend uses a Tree-sitter grammar (`dsl/tree-sitter-logicpilot/`).
Tree-sitter grammars are authored in `grammar.js` and compiled to a generated
`src/parser.c` via the `tree-sitter` CLI (Node-based). Regenerating `parser.c`
in every build would force a Node CLI dependency on the C++/Rust build path
and make builds non-reproducible across toolchains.

## Decision

- The **generated `parser.c` (and `tree_sitter/parser.h`) are committed to the
  repository** alongside `grammar.js`.
- Build steps compile the checked-in C sources directly; **no `tree-sitter`
  CLI invocation happens during normal builds** (CMake or Rust builds).
- Regeneration is an explicit, manual step (`tree-sitter generate` inside
  `dsl/tree-sitter-logicpilot/`, or `pnpm --dir dsl/tree-sitter-logicpilot
  generate`) performed when `grammar.js` changes, with the regenerated
  output committed in the same change.

## Consequences

- Positive: deterministic builds; C++/Rust toolchains need only a C compiler;
  grammar diffs are reviewable in code review.
- Negative: merge conflicts in generated `parser.c`; discipline required to
  regenerate and commit when the grammar changes (enforced by CI check).
