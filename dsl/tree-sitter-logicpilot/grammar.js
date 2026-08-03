/**
 * Tree-sitter grammar for the LogicPilot DSL — v0 subset.
 *
 * Aligned with docs/specs/dsl-spec.md (Draft v0), rules R1–R15, with one
 * documented extension: the `constant(x)` service-time distribution
 * (R16, task-mandated; absent from the draft spec).
 *
 * Design rulings (see dsl/tree-sitter-logicpilot/README.md):
 *  - Field "required" constraints (e.g. `capacity` in a resource) are
 *    semantic checks in the compiler, not grammar constraints; bodies are
 *    `repeat(field)` so the parser stays error-tolerant.
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
    // R1 — exactly one model per file; the top-level container.
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
      $.resource_declaration,
      $.process_declaration,
    ),

    // R2 — reusable resource type.
    resource_declaration: $ => seq(
      'resource',
      field('name', $.identifier),
      field('body', $.resource_body),
    ),

    resource_body: $ => seq(
      '{',
      repeat($._resource_field),
      '}',
    ),

    _resource_field: $ => choice(
      $.capacity_field,
      $.failure_rate_field,
    ),

    // R3 / R10 — `capacity = <Integer>` (resource capacity and queue size).
    capacity_field: $ => seq(
      'capacity',
      '=',
      field('value', $.integer),
    ),

    // R4 — `failure_rate = <Float>`.
    failure_rate_field: $ => seq(
      'failure_rate',
      '=',
      field('value', $.float),
    ),

    // R5 — entity flow; stages execute in declaration order.
    process_declaration: $ => seq(
      'process',
      field('name', $.identifier),
      field('body', $.process_body),
    ),

    process_body: $ => seq(
      '{',
      repeat($._stage),
      '}',
    ),

    _stage: $ => choice(
      $.source_declaration,
      $.queue_declaration,
      $.service_declaration,
    ),

    // R6 — entity arrival generator inside a process.
    source_declaration: $ => seq(
      'source',
      field('name', $.identifier),
      field('body', $.source_body),
    ),

    source_body: $ => seq(
      '{',
      repeat($.arrival_field),
      '}',
    ),

    // R7 — `arrival = <arrival_expr>`.
    arrival_field: $ => seq(
      'arrival',
      '=',
      field('value', $.arrival_expr),
    ),

    arrival_expr: $ => $.poisson_call,

    // R8 — `poisson(<Numeric>)`.
    poisson_call: $ => seq(
      'poisson',
      '(',
      field('rate', $._numeric),
      ')',
    ),

    // R9 — buffering stage inside a process.
    queue_declaration: $ => seq(
      'queue',
      field('name', $.identifier),
      field('body', $.queue_body),
    ),

    queue_body: $ => seq(
      '{',
      repeat($.capacity_field),
      '}',
    ),

    // R11 — processing stage bound to a resource.
    service_declaration: $ => seq(
      'service',
      field('name', $.identifier),
      field('body', $.service_body),
    ),

    service_body: $ => seq(
      '{',
      repeat($.time_field),
      '}',
    ),

    // R12 — `time = <service_time_expr>`.
    time_field: $ => seq(
      'time',
      '=',
      field('value', $.service_time_expr),
    ),

    service_time_expr: $ => choice(
      $.normal_call,
      $.exponential_call,
      $.constant_call,
    ),

    // R13 — `normal(<Numeric>, <Numeric>)` (mean, std-dev).
    normal_call: $ => seq(
      'normal',
      '(',
      field('mean', $._numeric),
      ',',
      field('stddev', $._numeric),
      ')',
    ),

    // R14 — `exponential(<Numeric>)`.
    exponential_call: $ => seq(
      'exponential',
      '(',
      field('rate', $._numeric),
      ')',
    ),

    // R16 (task-mandated extension) — `constant(<Numeric>)`.
    constant_call: $ => seq(
      'constant',
      '(',
      field('value', $._numeric),
      ')',
    ),

    // R15 — literals & identifiers.
    _numeric: $ => choice(
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
