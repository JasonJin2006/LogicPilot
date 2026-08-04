# tree-sitter-logicpilot

Tree-sitter grammar for the **LogicPilot DSL**, aligned with
[`docs/specs/dsl-spec.md`](../../docs/specs/dsl-spec.md). The grammar covers
the v0 process-flow core (rules R1–R15) plus `atomic`, `agent`,
`continuous`, `experiment` and the `constant(x)` distribution; the corpus
tests in `test/corpus/` are the executable rule reference.

Per [ADR-0005](../../docs/adr/0005-tree-sitter-parser-checked-in.md), the
generated `src/parser.c` (and friends) are **checked in**; builds never invoke
the tree-sitter CLI.

## Grammar summary (v0 core)

```text
source_file        := model_declaration                       // exactly one model per file
model_declaration  := 'model' Identifier model_body
model_body         := '{' (resource_declaration | process_declaration)* '}'
resource_declaration := 'resource' Identifier resource_body
resource_body      := '{' (capacity_field | failure_rate_field)* '}'
capacity_field     := 'capacity' '=' Integer                  // resource cap & queue size
failure_rate_field := 'failure_rate' '=' Float
process_declaration := 'process' Identifier process_body
process_body       := '{' (source_declaration | queue_declaration | service_declaration)* '}'
source_declaration := 'source' Identifier source_body
source_body        := '{' arrival_field* '}'
arrival_field      := 'arrival' '=' poisson_call
poisson_call       := 'poisson' '(' Numeric ')'
queue_declaration  := 'queue' Identifier queue_body
queue_body         := '{' capacity_field* '}'
service_declaration := 'service' Identifier service_body
service_body       := '{' time_field* '}'
time_field         := 'time' '=' service_time_expr
service_time_expr  := normal_call | exponential_call | constant_call
normal_call        := 'normal' '(' Numeric ',' Numeric ')'
exponential_call   := 'exponential' '(' Numeric ')'
constant_call      := 'constant' '(' Numeric ')'
Integer            := [0-9]+
Float              := [0-9]+\.[0-9]+
Identifier         := [A-Za-z_][A-Za-z0-9_]*
comment            := '//' … | '/* … */'                      // extras, non-nested blocks
```

Design rulings (spec gaps resolved in favour of "can express the mm1 queue
model + the Factory example"):

- **Field required-ness is semantic, not grammatical.** Bodies are
  `repeat(field)` so the parser stays error-tolerant (and empty-block corpus
  tests are possible). Required-field, range (`failure_rate` ∈ [0,1]),
  duplicate-field and resource-reference checks belong to the compiler
  (task #6), matching the spec's "Errors (compile-time)" section.
- **`capacity` is a single shared rule** (`capacity_field`) used by both
  resource bodies (R3) and queue bodies (R10) — both are `capacity = <Integer>`.
- **Distribution parameters accept integer or float** (`Numeric`), e.g.
  `poisson(2.5)` and `normal(10.5, 2.25)`.
- **`constant(x)`** added as `constant_call` beyond R13/R14.
- **Block comments `/* … */`** supported in addition to the spec's `//`
  line comments; block comments do not nest.
- Lexer ambiguity resolved with `prec.right` (longest-match on digit runs and
  on block-comment termination). `tree-sitter generate` reports no grammar
  conflicts.

## Regenerating the parser

Locked CLI: **tree-sitter-cli `0.26.11`** (official npm distribution package),
invoked without a local install via:

```powershell
cd dsl/tree-sitter-logicpilot
npm exec --yes tree-sitter-cli@0.26.11 -- generate
```

`tree-sitter init` is not needed: the checked-in `tree-sitter.json` drives
ABI 15 generation. Fallback CLI source: `cargo install tree-sitter-cli --locked`.

After any `grammar.js` change, regenerate and commit the output (`src/parser.c`,
`src/grammar.json`, `src/node-types.json`, `src/tree_sitter/parser.h`) in the
same change (ADR-0005).

## Running the corpus tests

```powershell
cd dsl/tree-sitter-logicpilot
# Windows without MSVC: point tree-sitter at MinGW GCC (see scripts/build-hello-kernel.ps1)
$env:PATH = 'C:\msys64\ucrt64\bin;' + $env:PATH
$env:CC = 'C:\msys64\ucrt64\bin\gcc.exe'
npm exec --yes tree-sitter-cli@0.26.11 -- test
```

Corpus files live in [`test/corpus/`](test/corpus/) — every grammar rule has
≥ 2 cases, plus end-to-end Factory / M/M/1 models and boundary cases (empty
blocks, multiple resources, interleaved comments).

## Layout

```text
grammar.js          # grammar definition (v0)
tree-sitter.json    # tree-sitter CLI metadata (ABI 15)
package.json        # npm language-package metadata
src/parser.c        # generated parser (checked in, ADR-0005)
src/grammar.json    # generated rule metadata
src/node-types.json # generated node-type table (used by the C++ compiler)
src/tree_sitter/    # generated runtime headers
test/corpus/        # corpus tests
```
