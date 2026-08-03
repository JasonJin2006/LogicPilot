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
};

}  // namespace logicpilot::dsl
