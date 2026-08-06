# tree-sitter-logicpilot

Tree-sitter grammar for the **LogicPilot DSL**, aligned with
[`docs/specs/dsl-v2.md`](../../docs/specs/dsl-v2.md). The grammar is the **v2
generic skeleton**: every declaration is `kind name { ... }` where `kind` is
any identifier, resolved by the compiler against the core kinds
(`agent`/`atomic`/`process`/`continuous`/`experiment`) and the process
library registry (`resource`/`source`/`queue`/`service`/`sink`). The corpus
tests in `test/corpus/` are the executable rule reference.

Per [ADR-0005](../../docs/adr/0005-tree-sitter-parser-checked-in.md), the
generated `src/parser.c` (and friends) are **checked in**; builds never invoke
the tree-sitter CLI.

## Grammar summary (v2 generic skeleton)

```text
source_file          := model_declaration                  // exactly one model per file
                     | library_declaration                  // or one library file (.lplib)
library_declaration  := 'library' Identifier library_body
library_body         := '{' (field | block_declaration)* '}'
block_declaration    := 'block' Identifier block_body
block_body           := '{' (typed_field | port_declaration)* '}'
typed_field          := Identifier ':' type_name ('=' value)?   // no default => required
model_declaration    := 'model' Identifier model_body
model_body           := '{' (use_declaration | variable_declaration | declaration | couple_declaration)* '}'
use_declaration      := 'use' Identifier
declaration          := Identifier Identifier declaration_body   // kind name { ... }
declaration_body     := '{' (member (';' | ',')?)* '}'          // optional separators
member               := field | variable_declaration | port_declaration | behavior | equation | declaration | couple_declaration
field                := Identifier '=' value | range_field
range_field          := 'range' '=' Integer '..' Integer
variable_declaration := ('state' | 'param') Identifier (':' type_name)? '=' value
port_declaration     := ('in' | 'out' | 'inout') Identifier? ':' type_name
behavior             := trigger Identifier? '{' (effect (';' | ',')?)* '}'
trigger              := 'on_' Identifier
effect               := assignment_effect | emit_effect | call_effect
assignment_effect    := Identifier '=' value
emit_effect          := 'emit' Identifier
call_effect          := Identifier Identifier?              // greedy arg (prec.right)
equation             := 'd' Identifier '/dt' '=' rhs_text
couple_declaration   := 'couple' Identifier '.' Identifier '->' Identifier '.' Identifier
value                := binary_expression | unary_expression | parenthesized_expression
                      | value_literal | Identifier | call
binary_expression    := value binary_op value            // prec.left: * / (2) tighter than + - (1)
unary_expression     := '-' value
parenthesized_expression := '(' value ')'
value_literal        := boolean_literal | Integer | Float | string_literal
call                 := Identifier '(' (value (',' value)*) ')'
type_name            := Identifier                          // builtins validated semantically
Integer              := [0-9]+
Float                := [0-9]+\.[0-9]+
Identifier           := [A-Za-z_][A-Za-z0-9_]*              // 'state'/'param'/'use'/'couple'/'d' resolve by context
comment              := '//' … | '/* … */'                  // extras, non-nested blocks
```

Design rulings (spec gaps resolved in favour of the thin-core design):

- **`kind` is free-form.** The grammar never enumerates block names; kind
  resolution (core kinds vs the process library registry) and field-shape
  validation (`LP2004` unknown/misplaced kind, `LP2005` unknown field) live
  in the compiler. Adding a library block never touches `grammar.js`.
- **Field required-ness is semantic, not grammatical.** Bodies are
  `repeat(...)` so the parser stays error-tolerant (and empty-block corpus
  tests are possible).
- **Effects are separated by `;` or `,`** (trailing separator optional);
  `call_effect` binds its optional argument greedily via `prec.right`
  (`flip active bounce` = `(flip active) (bounce)`).
- **Distribution constructors are generic calls** (`poisson`/`rate`/
  `exponential`/`normal`/`constant`), extracted positionally.
- **Comments** `//` and non-nesting `/* ... */` are extras.
- Lexer ambiguities resolved with `prec.right` (longest-match on digit runs
  and on block-comment termination). `tree-sitter generate` reports no
  grammar conflicts.

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

**CI enforces the sync** (`dsl-grammar` job): `npm run generate` followed by
`git diff --exit-code -- src/` (plus an untracked-files check), so a
`grammar.js` edit without a committed regeneration fails the build. The CLI
is pinned to 0.26.11, so generation is deterministic.

## Input hardening

The compiler rejects sources larger than 16 MiB up front (`LP0003`), and the
AST walkers are depth-capped (`LP0001` for expression nesting > 256 levels or
declaration nesting > 64 levels) with iterative cursor traversal, so
adversarial inputs cannot overflow the C++ stack or consume unbounded
resources.

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
grammar.js          # grammar definition (v2 generic skeleton)
tree-sitter.json    # tree-sitter CLI metadata (ABI 15)
package.json        # npm language-package metadata
src/parser.c        # generated parser (checked in, ADR-0005)
src/grammar.json    # generated rule metadata
src/node-types.json # generated node-type table (used by the C++ compiler)
src/tree_sitter/    # generated runtime headers
test/corpus/        # corpus tests
```
