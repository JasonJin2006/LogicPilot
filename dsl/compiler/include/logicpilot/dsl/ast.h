// Typed AST extracted from the tree-sitter parse tree (dsl-spec.md v0).
//
// The tree-sitter layer stays error-tolerant (bodies are `repeat(field)`),
// so the AST records presence/counts of fields; the semantic analyzer turns
// absence/duplication into diagnostics.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

enum class DistKind { kPoisson, kExponential, kNormal, kConstant };

[[nodiscard]] const char* to_string(DistKind kind);

struct Distribution {
  DistKind kind{DistKind::kConstant};
  // Positional parameters (poisson: [rate], exponential: [rate],
  // normal: [mean, stddev], constant: [value]).
  std::vector<double> params;
  Span span;
};

// One stage inside a process body. Which members are meaningful depends on
// `kind` (source: arrival; queue: capacity; service: service_time).
struct StageDecl {
  enum class Kind { kSource, kQueue, kService };

  Kind kind{Kind::kSource};
  std::string name;
  Span name_span;
  Span span;

  // source: `arrival = poisson(rate)`.
  bool has_arrival{false};
  int arrival_count{0};
  Distribution arrival;
  Span arrival_field_span;

  // queue: `capacity = <integer>`.
  bool has_capacity{false};
  int capacity_count{0};
  std::int64_t capacity{0};
  Span capacity_field_span;

  // service: `time = normal(...) | exponential(...) | constant(...)`.
  bool has_time{false};
  int time_count{0};
  Distribution service_time;
  Span time_field_span;
};

struct ResourceDecl {
  std::string name;
  Span name_span;
  Span span;

  bool has_capacity{false};
  int capacity_count{0};
  std::int64_t capacity{0};
  Span capacity_field_span;

  bool has_failure_rate{false};
  int failure_rate_count{0};
  double failure_rate{0.0};
  Span failure_rate_field_span;
};

// Value kinds for atomic state variables and transition effects (v1:
// literals only - no expressions).
enum class AtomicValueKind { kBool, kInt, kFloat };

struct AtomicValue {
  AtomicValueKind kind{AtomicValueKind::kBool};
  bool bool_value{false};
  std::int64_t int_value{0};
  double float_value{0.0};
  Span span;
};

// One transition effect: `state = literal`.
struct Effect {
  std::string name;
  Span name_span;
  AtomicValue value;
};

// `time_advance = <value | constant(...) | exponential(...) | infinite>`.
enum class TaKind { kConstant, kExponential, kInfinite };

struct TimeAdvanceDecl {
  bool has{false};
  int count{0};
  Span span;
  TaKind kind{TaKind::kConstant};
  double value{0.0};  // seconds (constant value or exponential rate)
};

// One state-variable declaration (each occurrence is one StateVarDecl; the
// analyzer flags duplicates by name).
struct StateVarDecl {
  std::string name;
  Span name_span;
  AtomicValue value;
};

// `on_input <port>: effects` or `on_timeout: effects [emit <port>]`.
struct TransitionDecl {
  bool has{false};
  int count{0};
  Span span;
  std::string port;  // on_input trigger port; "" for on_timeout
  Span port_span;
  std::vector<Effect> effects;
  bool emit{false};
  std::string emit_port;  // on_timeout output port
  Span emit_span;
};

struct AtomicDecl {
  std::string name;
  Span name_span;
  Span span;
  std::vector<StateVarDecl> state;
  TimeAdvanceDecl ta;
  std::vector<TransitionDecl> on_input;
  TransitionDecl on_timeout;
};

// One `on_tick <handler> [arg]` agent behavior.
struct TickBehavior {
  bool has{false};
  int count{0};
  Span span;
  std::string handler;
  Span handler_span;
  bool has_arg{false};
  std::string arg;
  Span arg_span;
};

struct AgentDecl {
  std::string name;
  Span name_span;
  Span span;
  // `count = <n>` population size.
  bool has_count{false};
  int count_count{0};
  std::int64_t count{1};
  Span count_field_span;
  std::vector<StateVarDecl> state;
  std::vector<TickBehavior> behaviors;
};

// `continuous` block: structured ODEs (Phase D2).
struct EquationDecl {
  std::string name;
  Span name_span;
  Span span;
  std::vector<StateVarDecl> state;  // `state <name> = <initial>`
  struct ParamDecl {
    std::string name;
    Span name_span;
    double value{0.0};
    Span span;
  };
  std::vector<ParamDecl> params;  // `param <name> = <value>`
  struct Equation {
    std::string var;
    std::string rhs_text;
    Span span;
  };
  std::vector<Equation> equations;  // `d <var>/dt = <rhs>`
};

// `experiment` block: the model declares its own run/optimization setup
// (IR v2 direction; v1 carries it as a compile sidecar, not in F1).
struct ExperimentDecl {
  std::string name;
  Span name_span;
  Span span;
  bool has_objective{false};
  int objective_count{0};
  std::string objective;  // "maximize" | "minimize"
  Span objective_span;
  bool has_metric{false};
  int metric_count{0};
  std::string metric;  // "throughput" | "Wq" | "W" | "Lq"
  Span metric_span;
  bool has_variable{false};
  int variable_count{0};
  std::string variable;  // v0.1: "servers"
  Span variable_span;
  bool has_range{false};
  int range_count{0};
  std::int64_t range_min{1};
  std::int64_t range_max{1};
  Span range_span;
  bool has_budget{false};
  int budget_count{0};
  std::int64_t budget{20};
  Span budget_span;
};

// `couple <from_model>.<from_port> -> <to_model>.<to_port>`.
struct CoupleDecl {
  std::string from_model;
  std::string from_port;
  std::string to_model;
  std::string to_port;
  Span span;
};

struct ProcessDecl {
  std::string name;
  Span name_span;
  Span span;
  std::vector<StageDecl> stages;  // declaration order is semantic order
};

struct ModelAst {
  std::string name;
  Span name_span;
  Span span;
  std::vector<ResourceDecl> resources;
  std::vector<ProcessDecl> processes;
  std::vector<AtomicDecl> atomics;
  std::vector<AgentDecl> agents;
  std::vector<EquationDecl> continuous;
  std::vector<ExperimentDecl> experiments;
  std::vector<CoupleDecl> couplings;
};

}  // namespace logicpilot::dsl
