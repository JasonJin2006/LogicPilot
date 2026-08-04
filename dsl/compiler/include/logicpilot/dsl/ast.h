// Typed AST extracted from the tree-sitter parse tree (dsl-v2 generic
// skeleton, docs/specs/dsl-v2.md).
//
// The grammar is deliberately thin: `kind` is any identifier and bodies are
// error-tolerant repeats, so this AST is generic too - one `Node` per
// declaration, with kind resolution and shape validation left to the
// semantic analyzer (core kinds + library registry). Presence/counts are
// recorded per field so the analyzer can emit duplicate/missing diagnostics.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

enum class DistKind { kPoisson, kExponential, kNormal, kConstant };

[[nodiscard]] const char* to_string(DistKind kind);

struct Distribution {
  DistKind kind{DistKind::kConstant};
  // Positional parameters (poisson/rate: [rate], exponential: [rate],
  // normal: [mean, stddev], constant: [value]).
  std::vector<double> params;
  Span span;
};

// A field/effect value: expression tree (Phase D). Literals, bare
// identifiers (references), numeric calls (distribution constructors) and
// arithmetic (unary/binary/parenthesized) share one node type; the compiler
// constant-folds numeric positions and resolves parameter references.
enum class ValueKind {
  kBool,
  kInt,
  kFloat,
  kString,
  kIdentifier,
  kCall,
  kNegate,
  kAdd,
  kSub,
  kMul,
  kDiv,
  kParen,
};

struct Value {
  ValueKind kind{ValueKind::kInt};
  bool bool_value{false};
  std::int64_t int_value{0};
  double float_value{0.0};
  std::string string_value;   // kString / kIdentifier
  std::string call_name;      // kCall: distribution constructor, ...
  std::vector<Value> call_args;  // kCall expression arguments
  std::vector<Value> operands;   // kNegate/kParen: 1; kAdd/kSub/kMul/kDiv: 2
  Span span;
};

// A compile-time constant after folding (literal, resolved param, or
// arithmetic result). `kind` is one of kBool/kInt/kFloat/kString.
struct FoldedValue {
  ValueKind kind{ValueKind::kInt};
  bool bool_value{false};
  std::int64_t int_value{0};
  double float_value{0.0};
  std::string string_value;
};

// Parameter scope for compile-time expression resolution: model-level
// `param` declarations plus container-local `param`s.
class ParamScope {
 public:
  void declare(const std::string& name, const FoldedValue& value) {
    values_[name] = value;
  }
  bool lookup(const std::string& name, FoldedValue& out) const {
    const auto it = values_.find(name);
    if (it == values_.end()) {
      return false;
    }
    out = it->second;
    return true;
  }

 private:
  std::unordered_map<std::string, FoldedValue> values_;
};

// One `name = <value>` field (each occurrence is one Field; the analyzer
// flags duplicates by name).
struct Field {
  std::string name;
  Span name_span;
  Span span;
  Value value;
};

// `state x = <value>` / `param k = <value>` with an optional type
// annotation.
struct VarDecl {
  std::string keyword;  // "state" | "param"
  std::string name;
  Span name_span;
  std::string type;     // "" unless annotated
  Value value;
  Span span;
};

// `in [name]: type` / `out [name]: type` / `inout [name]: type` (unnamed
// ports default to `entity` in the library layer).
struct PortDecl {
  std::string direction;  // "in" | "out" | "inout"
  std::string name;       // "" => "entity"
  std::string type;
  Span span;
};

// One effect inside `on_<trigger> { ... }`.
struct Effect {
  enum class Kind { kAssign, kEmit, kCall };

  Kind kind{Kind::kAssign};
  std::string name;   // kAssign: state variable; kEmit: port; kCall: handler
  Span name_span;
  Value value;        // kAssign value
  std::string arg;    // kCall optional argument ("" if none)
  Span arg_span;
};

// `on_<trigger> [port] { effect; ... }` (trigger without the `on_` prefix).
struct Behavior {
  std::string trigger;  // "timeout" | "tick" | "input" | ...
  Span span;
  std::string port;     // message-trigger channel (on_input <port>)
  Span port_span;
  std::vector<Effect> effects;
};

// `d <var>/dt = <rhs>` (raw RHS text until expressions land).
struct Equation {
  std::string var;
  std::string rhs_text;
  Span span;
};

// `couple <from_model>.<from_port> -> <to_model>.<to_port>`.
struct CoupleDecl {
  std::string from_model;
  std::string from_port;
  std::string to_model;
  std::string to_port;
  Span span;
};

// `range = <min>..<max>` (experiment blocks).
struct RangeField {
  std::int64_t min{1};
  std::int64_t max{1};
  Span span;
};

// One declaration: `kind name { ... }`. `kind` is resolved by the semantic
// analyzer (core kinds or a registered library block).
struct Node {
  std::string kind;
  std::string name;
  Span name_span;
  Span span;
  std::vector<Field> fields;
  std::vector<VarDecl> vars;
  std::vector<PortDecl> ports;
  std::vector<Behavior> behaviors;
  std::vector<Equation> equations;
  std::vector<RangeField> ranges;
  std::vector<CoupleDecl> couplings;
  std::vector<Node> children;
};

// `experiment` block (core config kind; kept typed for lowering and the
// sidecar serializer).
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

// ---------------------------------------------------------------------------
// Library meta-layer (Phase E): block shapes are declared in DSL files
// (libraries/*.lplib) and loaded into the compiler's block registry.
// ---------------------------------------------------------------------------

// `name: type [= default]` — one typed block parameter. A parameter without
// a default is required; with a default it is optional.
struct LibraryParam {
  std::string name;
  std::string type;  // "int" | "float" | "bool" | "string" |
                     // "distribution" | "ref"
  bool has_default{false};
  Value default_value;
  Span span;
};

struct LibraryPort {
  std::string direction;  // "in" | "out" | "inout"
  std::string name;       // "" => "entity"
  std::string type;
  Span span;
};

struct LibraryBlock {
  std::string kind;
  Span span;
  std::vector<LibraryParam> params;
  std::vector<LibraryPort> ports;
};

struct LibraryAst {
  std::string name;
  std::int64_t version{1};
  Span span;
  std::vector<LibraryBlock> blocks;
};

// Whole model file: model-level params, top-level declarations in source
// order, couplings and typed experiment blocks.
struct ModelAst {
  std::string name;
  Span name_span;
  Span span;
  std::vector<std::string> used_libraries;
  std::vector<VarDecl> params;  // model-level `param` declarations
  std::vector<Node> members;    // top-level declarations (source order)
  std::vector<CoupleDecl> couplings;
  std::vector<ExperimentDecl> experiments;
};

// Field lookup helpers for semantic/lowering (nullptr when absent).
[[nodiscard]] const Field* find_field(const Node& node, const char* name);
[[nodiscard]] const VarDecl* find_var(const Node& node, const char* keyword,
                                      const std::string& name);

// value -> distribution (v2 stage 1 constructors: poisson/rate,
// exponential, normal, constant); arguments must already be folded
// literals. Returns false when the value is not a recognized distribution
// call.
[[nodiscard]] bool distribution_from_value(const Value& value,
                                           Distribution& out);

// Constant-fold an expression to a literal-only Value (kCall keeps its
// folded arguments; identifiers resolve against `scope`). Returns false when
// an identifier cannot be resolved, arithmetic operands are non-numeric, or
// division by zero occurs.
[[nodiscard]] bool fold_value(const Value& value, const ParamScope& scope,
                              Value& out);

}  // namespace logicpilot::dsl
