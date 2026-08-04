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
    // One model per file; the top-level container.
    source_file: $ => $.model_declaration,

    model_declaration: $ => seq(
      'model',
      field('name', $.identifier),
      field('body', $.model_body),
    ),

    model_body: $ => seq(
      '{',
      repeat($._model_member),
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
      repeat($._declaration_member),
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

    // `in [name]: type` / `out [name]: type` / `inout [name]: type`;
    // unnamed ports default to `entity` (process blocks).
    port_declaration: $ => seq(
      choice('in', 'out', 'inout'),
      optional(field('name', $.identifier)),
      ':',
      field('type', $.type_name),
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

    value: $ => choice(
      $.value_literal,
      $.identifier,
      $.call,
    ),

    value_literal: $ => choice(
      $.boolean_literal,
      $.integer,
      $.float,
      $.string_literal,
    ),

    boolean_literal: $ => choice('true', 'false'),

    string_literal: $ => token(seq('"', /[^"\n]*/, '"')),

    // Generic call with numeric arguments (distribution constructors in
    // v2 stage 1: poisson / rate / exponential / normal / constant).
    call: $ => seq(
      field('name', $.identifier),
      '(',
      field('args', $.argument_list),
      ')',
    ),

    argument_list: $ => seq(
      $._argument,
      repeat(seq(',', $._argument)),
    ),

    _argument: $ => choice(
      $.integer,
      $.float,
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
