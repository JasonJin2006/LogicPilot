/**
 * Tree-sitter grammar for the LogicPilot DSL - v2 generic skeleton.
 *
 * Thin core grammar (docs/specs/dsl-v2.md): `kind` is any identifier and is
 * resolved by semantic analysis against the core kinds
 * (model/agent/atomic/process/continuous/experiment) and the library
 * registry (process: resource/source/queue/service/sink). The grammar is
 * block-name agnostic - adding a library block never touches this file
 * (AnyLogic palette / FMI idea).
 *
 * Design rulings:
 *  - Bodies are `repeat(...)` and `kind` is free-form so the parser stays
 *    error-tolerant; semantic analysis turns unknown kinds, unknown fields
 *    and bad values into LP-coded diagnostics with spans.
 *  - Exactly one `model` per file is enforced grammatically
 *    (`source_file` = a single `model_declaration`).
 */
module.exports = grammar({
  name: 'logicpilot',

  // Whitespace and comments may appear between any two tokens.
  extras: $ => [/\s/, $.comment],

  // Keyword extraction: bare-word tokens win over this token.
  word: $ => $.identifier,

  rules: {
    // One model per file (or one library definition file, .lplib).
    source_file: $ => choice(
      $.model_declaration,
      $.library_declaration,
    ),

    // ------------------------------------------------------------------
    // Library meta-layer: block shapes are declared in DSL (Phase E).
    // ------------------------------------------------------------------

    library_declaration: $ => seq(
      'library',
      field('name', $.identifier),
      field('body', $.library_body),
    ),

    library_body: $ => seq(
      '{',
      repeat($._library_member),
      '}',
    ),

    _library_member: $ => choice(
      $.field,               // `version = <int>`
      $.block_declaration,
    ),

    block_declaration: $ => seq(
      'block',
      field('name', $.identifier),
      field('body', $.block_body),
    ),

    block_body: $ => seq(
      '{',
      repeat($._block_member),
      '}',
    ),

    _block_member: $ => choice(
      $.typed_field,
      $.port_declaration,
    ),

    // `name: type [= default]` — a typed block parameter. A parameter
    // without a default is required; with a default it is optional.
    typed_field: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $.type_name),
      optional(seq('=', field('default', $.value))),
    ),

    model_declaration: $ => seq(
      'model',
      field('name', $.identifier),
      field('body', $.model_body),
    ),

    model_body: $ => seq(
      '{',
      // Optional `;` / `,` separators: both `a = 1; b = 2` and newline-
      // separated members are accepted (separators are anonymous tokens).
      repeat(seq($._model_member, optional(choice(';', ',')))),
      '}',
    ),

    _model_member: $ => choice(
      $.use_declaration,
      $.variable_declaration,
      $.declaration,
      $.couple_declaration,
    ),

    // `use <library>` - optional in v2 stage 1 (the standard process
    // library is implicitly available); validated once multiple libraries
    // land (Phase E).
    use_declaration: $ => seq(
      'use',
      field('library', $.identifier),
    ),

    // Generic declaration: `kind name { ... }`. `kind` is resolved
    // semantically (core kinds or a registered library block name).
    declaration: $ => seq(
      field('kind', $.identifier),
      field('name', $.identifier),
      field('body', $.declaration_body),
    ),

    declaration_body: $ => seq(
      '{',
      repeat(seq($._declaration_member, optional(choice(';', ',')))),
      '}',
    ),

    _declaration_member: $ => choice(
      $.field,
      $.variable_declaration,
      $.port_declaration,
      $.behavior,
      $.equation,
      $.declaration,
      $.couple_declaration,
    ),

    // `name = <value>`, plus the special `range = <min>..<max>` form used
    // by experiment blocks.
    field: $ => choice(
      seq(
        field('name', $.identifier),
        '=',
        field('value', $.value),
      ),
      $.range_field,
    ),

    range_field: $ => seq(
      'range',
      '=',
      field('min', $.integer),
      '..',
      field('max', $.integer),
    ),

    // `state x = <value>` / `param k = <value>` with an optional type
    // annotation (`state active: bool = true`).
    variable_declaration: $ => seq(
      choice('state', 'param'),
      field('name', $.identifier),
      optional(seq(':', field('type', $.type_name))),
      '=',
      field('value', $.value),
    ),

    // Type names are free identifiers (builtin scalars int/float/bool/string/
    // distribution/ref are validated semantically; custom schema types such
    // as Job/Signal are legal port types).
    type_name: $ => $.identifier,

    // `in [name]: type [when <field>]` / `out [name]: type [when <field>]` /
    // `inout [name]: type`; unnamed ports default to `entity` (process
    // blocks). The optional `when <field>` marks a conditional port that is
    // only available when the named block field evaluates to true (e.g.
    // `outTimeout: entity when enableTimeout`).
    port_declaration: $ => seq(
      choice('in', 'out', 'inout'),
      optional(field('name', $.identifier)),
      ':',
      field('type', $.type_name),
      optional(seq('when', field('condition', $.identifier))),
    ),

    // Unified behavior: `on_<trigger> [port] { effect; ... }`. The trigger
    // token carries the `on_` prefix (e.g. on_timeout, on_tick, on_input);
    // `port` is the message channel for message triggers.
    behavior: $ => seq(
      field('trigger', $.trigger),
      optional(field('port', $.identifier)),
      field('effects', $.effect_list),
    ),

    trigger: $ => token(seq('on_', /[A-Za-z_][A-Za-z0-9_]*/)),

    effect_list: $ => seq(
      '{',
      repeat(seq($.effect, optional(choice(';', ',')))),
      '}',
    ),

    effect: $ => choice(
      $.assignment_effect,
      $.emit_effect,
      $.call_effect,
    ),

    assignment_effect: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $.value),
    ),

    emit_effect: $ => seq(
      'emit',
      field('port', $.identifier),
    ),

    // `prec.right` greedily binds the optional argument to the call
    // (`flip active bounce` = `(flip active) (bounce)`).
    call_effect: $ => prec.right(seq(
      field('handler', $.identifier),
      optional(field('arg', $.identifier)),
    )),

    // Structured ODE: `d <name>/dt = <rhs-text>` (raw RHS until
    // expressions land in Phase D; trimmed by the extractor).
    equation: $ => seq(
      'd',
      field('name', $.identifier),
      '/dt',
      '=',
      field('rhs', $.rhs_text),
    ),

    rhs_text: $ => token(prec(1, /[^\n\r}]+/)),

    // `couple <from_model>.<from_port> -> <to_model>.<to_port>`.
    couple_declaration: $ => seq(
      'couple',
      field('from_model', $.identifier),
      '.',
      field('from_port', $.identifier),
      '->',
      field('to_model', $.identifier),
      '.',
      field('to_port', $.identifier),
    ),

    // Expression grammar (Phase D): literals, identifiers, calls, unary
    // negation, binary arithmetic and parenthesized groups. Field values
    // are constant-folded by the compiler; parameter references resolve
    // against declared `param`s.
    value: $ => choice(
      $.binary_expression,
      $.unary_expression,
      $.parenthesized_expression,
      $.field_access,
      $.value_literal,
      $.identifier,
      $.call,
    ),

    // `agent1.kind` — member access over a named scope (match conditions).
    field_access: $ => seq(
      field('base', $.identifier),
      '.',
      field('field', $.identifier),
    ),

    binary_expression: $ => choice(
      // Higher precedence binds tighter: `1 + 2 * 3` = `1 + (2 * 3)`.
      prec.left(2, seq(
        field('left', $.value),
        field('op', $.binary_op),
        field('right', $.value),
      )),
      prec.left(1, seq(
        field('left', $.value),
        field('op', $.binary_op),
        field('right', $.value),
      )),
      // Comparisons bind looser than arithmetic: `a + b < c` = `(a + b) < c`.
      prec.left(0, seq(
        field('left', $.value),
        field('op', $.binary_op),
        field('right', $.value),
      )),
    ),

    binary_op: $ => choice(
      '+', '-', '*', '/', '<', '>', '<=', '>=', '==', '!='
    ),

    unary_expression: $ => prec(3, seq(
      field('op', $.unary_op),
      field('operand', $.value),
    )),

    unary_op: $ => '-',

    parenthesized_expression: $ => seq(
      '(',
      field('value', $.value),
      ')',
    ),

    value_literal: $ => choice(
      $.boolean_literal,
      $.integer,
      $.float,
      $.string_literal,
    ),

    boolean_literal: $ => choice('true', 'false'),

    string_literal: $ => token(seq('"', /[^"\n]*/, '"')),

    // Generic call (distribution constructors in v2 stage 1: poisson /
    // rate / exponential / normal / constant); arguments are expressions
    // so `rate(2 * arrival_rate)` folds at compile time.
    call: $ => seq(
      field('name', $.identifier),
      '(',
      field('args', $.argument_list),
      ')',
    ),

    argument_list: $ => seq(
      $.value,
      repeat(seq(',', $.value)),
    ),

    // `prec.right` favours longest match on digit runs: "10" parses as one
    // integer, never as two adjacent integers; "10.5" prefers float.
    integer: $ => prec.right(token(/[0-9]+/)),

    float: $ => prec.right(token(/[0-9]+\.[0-9]+/)),

    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,

    // `//` line comments and `/* ... */` block comments (non-nested;
    // `prec.right` keeps the closing `*/` bound to the nearest opening `/*`).
    comment: $ => token(prec.right(choice(
      seq('//', /[^\n]*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    ))),
  },
});
