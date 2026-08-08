// Semantic analysis implementation (dsl-v2 generic, docs/specs/dsl-v2.md;
// see semantic.h for the check catalogue and diagnostic codes).
//
// Kind resolution drives everything: `kind` is resolved against the core
// kinds (agent/atomic/continuous/experiment) and the builtin
// process library registry (resource/source/queue/service/sink); block
// instances are then validated against their registered shape (required
// fields, duplicates, ranges, references). Numeric fields are
// constant-folded (Phase D): expressions must reduce to literals via
// arithmetic and parameter references (LP2006 otherwise).
#include "logicpilot/dsl/semantic.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <unordered_set>

#include "logicpilot/dsl/registry.h"

namespace logicpilot::dsl {
namespace {

bool is_scalar(const Value& value) {
  return value.kind == ValueKind::kBool || value.kind == ValueKind::kInt ||
         value.kind == ValueKind::kFloat || value.kind == ValueKind::kString;
}

FoldedValue to_folded(const Value& value) {
  FoldedValue folded;
  folded.kind = value.kind;
  folded.bool_value = value.bool_value;
  folded.int_value = value.int_value;
  folded.float_value = value.float_value;
  folded.string_value = value.string_value;
  return folded;
}

double folded_double(const Value& value) {
  return value.kind == ValueKind::kInt ? static_cast<double>(value.int_value) : value.float_value;
}

bool value_is_constant(const Value& value) {
  return value.kind == ValueKind::kBool || value.kind == ValueKind::kInt ||
         value.kind == ValueKind::kFloat || value.kind == ValueKind::kString;
}

// Collect bare identifiers inside a value tree that are not in `known`
// (used to validate runtime condition expressions at compile time).
void collect_unknown_identifiers(const Value& value, const std::unordered_set<std::string>& known,
                                 std::vector<std::string>& unknown) {
  if (value.kind == ValueKind::kIdentifier) {
    if (known.count(value.string_value) == 0) {
      unknown.push_back(value.string_value);
    }
    return;
  }
  for (const Value& operand : value.operands) {
    collect_unknown_identifiers(operand, known, unknown);
  }
  for (const Value& arg : value.call_args) {
    collect_unknown_identifiers(arg, known, unknown);
  }
}

class Analyzer {
public:
  std::vector<Diagnostic> run(const ModelAst& model, const LibraryRegistry* registry,
                              const std::vector<std::string>* libraries) {
    registry_ = registry != nullptr ? registry : &builtin_process_registry();
    libraries_ = libraries;
    declared_resources_.clear();
    entity_attribute_names_.clear();
    for (const Node& member : model.members) {
      if (member.kind == "resource") {
        declared_resources_.insert(member.name);
      }
    }
    collect_entity_attributes(model.members);
    check_model_params(model);
    build_model_scope(model);
    for (const std::string& library : model.used_libraries) {
      check_library(library);
    }
    check_top_level_names(model);
    for (const Node& member : model.members) {
      check_decl(member, true, model_scope_);
    }
    // Agent-centric flows: process-library members may live directly in the
    // model root (or an agent body); validate the root scope like a flow
    // (source required, couplings checked against the block shapes).
    check_flow_scope(model.members, model.couplings, "model", model.span);
    std::unordered_map<std::string, std::string> model_param_types;
    for (const VarDecl& param : model.params) {
      if (param.keyword == "param") {
        model_param_types.emplace(param.name, param.type);
      }
    }
    for (const ExperimentDecl& experiment : model.experiments) {
      check_experiment(experiment, model_param_types);
    }
    check_couplings(model);
    // Deterministic ordering for golden output: source order, then code.
    std::stable_sort(diagnostics_.begin(), diagnostics_.end(),
                     [](const Diagnostic& a, const Diagnostic& b) {
                       if (a.span.line != b.span.line) {
                         return a.span.line < b.span.line;
                       }
                       if (a.span.column != b.span.column) {
                         return a.span.column < b.span.column;
                       }
                       return a.code < b.code;
                     });
    return std::move(diagnostics_);
  }

private:
  const std::vector<std::string>* libraries_{nullptr};

  void push(Severity severity, const char* code, const std::string& message, const Span& span) {
    Diagnostic diagnostic;
    diagnostic.severity = severity;
    diagnostic.code = code;
    diagnostic.message = message;
    diagnostic.span = span;
    diagnostics_.push_back(std::move(diagnostic));
  }

  void error(const char* code, const std::string& message, const Span& span) {
    push(Severity::kError, code, message, span);
  }

  // ------------------------------------------------------------------
  // Model level
  // ------------------------------------------------------------------

  void check_model_params(const ModelAst& model) {
    std::unordered_map<std::string, Span> declared;
    for (const VarDecl& param : model.params) {
      if (param.keyword != "param") {
        error("LP2004",
              "state variables must be declared inside an element "
              "(agent/atomic/continuous), not at model level",
              param.span);
        continue;
      }
      const auto [it, inserted] = declared.emplace(param.name, param.name_span);
      if (!inserted) {
        error("LP1001",
              "duplicate declaration of param '" + param.name + "' (previously declared at line " +
                  std::to_string(it->second.line) + ")",
              param.name_span);
      }
    }
  }

  // Fold model-level params into the shared scope (LP2006 on non-constant).
  void build_model_scope(const ModelAst& model) {
    for (const VarDecl& param : model.params) {
      if (param.keyword != "param") {
        continue;
      }
      Value folded;
      if (!fold_value(param.value, model_scope_, folded) || !is_scalar(folded)) {
        error("LP2006",
              "param '" + param.name +
                  "' must be a compile-time constant (literals, earlier "
                  "params, arithmetic)",
              param.span);
        continue;
      }
      model_scope_.declare(param.name, to_folded(folded));
    }
  }

  // `use` is validated once multiple libraries land (Phase E); for now the
  // standard process library is implicitly available.
  void check_library(const std::string& library) {
    bool loaded = library == "process";
    if (!loaded && libraries_ != nullptr) {
      for (const std::string& name : *libraries_) {
        if (name == library) {
          loaded = true;
          break;
        }
      }
    }
    if (!loaded) {
      error(
          "LP2004",
          "unknown library '" + library + "' (not a loaded library: 'process' or a 'use'd .lplib)",
          Span{});
    }
  }

  // Scope resolution: model member names are one shared namespace.
  void check_top_level_names(const ModelAst& model) {
    std::unordered_map<std::string, Span> declared;
    for (const Node& member : model.members) {
      if (member.kind == "experiment") {
        continue;  // experiment names are not in the model namespace (v0)
      }
      const auto [it, inserted] = declared.emplace(member.name, member.name_span);
      if (!inserted) {
        error("LP1001",
              "duplicate declaration of " + member.kind + " '" + member.name +
                  "' (previously declared at line " + std::to_string(it->second.line) + ")",
              member.name_span);
      }
    }
  }

  // ------------------------------------------------------------------
  // Generic declaration dispatch (kind resolution)
  // ------------------------------------------------------------------

  void check_decl(const Node& node, bool top_level, const ParamScope& parent_scope) {
    const std::string& kind = node.kind;
    if (kind == "process") {
      error("LP2004",
            "process containers were removed; write process library blocks "
            "directly under the model/agent scope",
            node.name_span);
      return;
    }
    if (kind == "atomic") {
      check_atomic(node, scope_with(node, parent_scope));
      return;
    }
    if (kind == "agent") {
      check_agent(node, scope_with(node, parent_scope));
      return;
    }
    if (kind == "continuous") {
      check_continuous(node, scope_with(node, parent_scope));
      return;
    }
    if (kind == "experiment") {
      return;  // validated via the typed ExperimentDecl list below
    }
    if (kind == "node") {
      check_node(node, parent_scope);
      return;
    }
    if (kind == "path") {
      check_path(node);
      return;
    }
    if (kind == "statechart") {
      check_statechart(node);
      return;
    }
    if (registry_ != nullptr && registry_->has_block(node.registry_key())) {
      // Process-library blocks (source/queue/service/... and resource) are
      // valid members of the model root and agent bodies (agent-centric
      // structure).
      check_process_block(node, parent_scope);
      return;
    }
    if (registry_ != nullptr && node.kind_library.empty() && registry_->is_ambiguous(kind)) {
      error("LP2013", "ambiguous declaration kind '" + kind + "'; qualify it as library::block",
            node.span);
      return;
    }
    error("LP2004",
          "unknown declaration kind '" + kind +
              "' (core kinds: "
              "agent/atomic/continuous/experiment/node/path; process library: "
              "resource/source/queue/service/sink)",
          node.name_span);
  }

  // Spatial markup: `node <Name> { x = <f>; y = <f>; z = <f> }` anchors the
  // moveTo destination (AnyLogic node markup; coordinates are numeric
  // constants).
  void check_node(const Node& node, const ParamScope& scope) {
    for (const char* field_name : {"x", "y", "z"}) {
      const Field* field = field_of(node, field_name);
      if (field == nullptr) {
        continue;
      }
      Value folded;
      if (!fold_value(field->value, scope, folded) ||
          (folded.kind != ValueKind::kInt && folded.kind != ValueKind::kFloat)) {
        error("LP3001",
              "node '" + node.name + "' field '" + field_name + "' must be a numeric constant",
              field->span);
      }
    }
  }

  // Network edge: `path <Name> { node1 = <Node>; node2 = <Node> }` links two
  // nodes with a straight segment (weight = Euclidean distance).
  void check_path(const Node& node) {
    for (const char* field_name : {"node1", "node2"}) {
      const Field* field = field_of(node, field_name);
      if (field != nullptr && field->value.kind != ValueKind::kIdentifier) {
        error("LP3001", "path '" + node.name + "' field '" + field_name + "' must reference a node",
              field->span);
      }
    }
  }

  // ------------------------------------------------------------------
  // Statecharts (AnyLogic Statechart palette)
  // ------------------------------------------------------------------

  // A statechart container holds state elements; transitions reference
  // states by name (`from`/`to`), and `initial` names the entry state.
  void check_statechart(const Node& node) {
    const Field* initial = field_of(node, "initial");
    if (initial != nullptr && initial->value.kind != ValueKind::kIdentifier) {
      error("LP3001",
            "statechart '" + node.name + "' field 'initial' must reference a state by name",
            initial->span);
    }
    std::unordered_set<std::string> state_names;
    for (const Node& child : node.children) {
      if (child.kind == "state" || child.kind == "finalState" || child.kind == "historyState" ||
          child.kind == "branch") {
        state_names.insert(child.name);
        // Action fields accept any expression; nothing to validate yet.
        continue;
      }
      if (child.kind == "transition") {
        for (const char* ref : {"from", "to"}) {
          const Field* field = field_of(child, ref);
          if (field != nullptr && field->value.kind != ValueKind::kIdentifier) {
            error("LP3001",
                  "transition '" + child.name + "' field '" + ref +
                      "' must reference a state by name",
                  field->span);
          }
        }
        const Field* triggered_by = field_of(child, "triggeredBy");
        if (triggered_by != nullptr && (triggered_by->value.kind != ValueKind::kIdentifier ||
                                        !is_statechart_trigger(triggered_by->value.string_value))) {
          error("LP3001",
                "transition '" + child.name +
                    "' field 'triggeredBy' must be one of "
                    "timeout/rate/condition/message",
                triggered_by->span);
        }
        continue;
      }
      if (child.kind == "statechartEntryPoint" || child.kind == "initialStatePointer") {
        continue;
      }
      error("LP2004",
            "statechart '" + node.name + "' contains unknown element kind '" + child.kind +
                "' (statechart elements: state/transition/"
                "branch/finalState/historyState/statechartEntryPoint/"
                "initialStatePointer)",
            child.name_span);
    }
    if (initial != nullptr && state_names.count(initial->value.string_value) == 0) {
      error("LP3001",
            "statechart '" + node.name + "' initial state '" + initial->value.string_value +
                "' is not a state inside the statechart",
            initial->span);
    }
  }

  static bool is_statechart_trigger(const std::string& value) {
    return value == "timeout" || value == "rate" || value == "condition" || value == "message";
  }

  // ------------------------------------------------------------------
  // Field / shape helpers
  // ------------------------------------------------------------------

  const Field* field_of(const Node& node, const char* name) const {
    for (const Field& field : node.fields) {
      if (field.name == name) {
        return &field;
      }
    }
    return nullptr;
  }

  int field_count(const Node& node, const std::string& name) const {
    int count = 0;
    for (const Field& field : node.fields) {
      if (field.name == name) {
        ++count;
      }
    }
    return count;
  }

  // Unknown-field / unknown-var checks against a block's registered shape.
  void check_shape(const Node& node, const std::unordered_set<std::string>& allowed_fields,
                   const std::unordered_set<std::string>& allowed_vars) {
    for (const Field& field : node.fields) {
      if (!allowed_fields.count(field.name)) {
        error("LP2005",
              "unknown field '" + field.name + "' in " + node.kind + " '" + node.name + "'",
              field.name_span);
      }
    }
    for (const VarDecl& var : node.vars) {
      if (!allowed_vars.count(var.keyword)) {
        error("LP2005",
              "'" + var.keyword + "' is not allowed in " + node.kind + " '" + node.name + "'",
              var.span);
      }
    }
  }

  void check_duplicate(const Node& node, const char* field_name) {
    if (field_count(node, field_name) > 1) {
      const Field* last = nullptr;
      for (const Field& field : node.fields) {
        if (field.name == field_name) {
          last = &field;
        }
      }
      error("LP1002",
            "duplicate field '" + std::string(field_name) + "' in " + node.kind + " '" + node.name +
                "'",
            last ? last->span : node.span);
    }
  }

  void check_missing(const Node& node, const char* field_name, const Field* field) {
    if (field == nullptr) {
      error("LP2001",
            "missing required field '" + std::string(field_name) + "' in " + node.kind + " '" +
                node.name + "'",
            node.span);
    }
  }

  // Container-local param scope: parent scope + this node's `param`s.
  ParamScope scope_with(const Node& node, const ParamScope& parent) {
    ParamScope scope = parent;
    for (const VarDecl& var : node.vars) {
      if (var.keyword != "param") {
        continue;
      }
      Value folded;
      if (!fold_value(var.value, scope, folded) || !is_scalar(folded)) {
        error("LP2006",
              "param '" + var.name + "' in " + node.kind + " '" + node.name +
                  "' must be a compile-time constant (literals, earlier "
                  "params, arithmetic)",
              var.span);
        continue;
      }
      scope.declare(var.name, to_folded(folded));
    }
    return scope;
  }

  // Fold a numeric field value; emits LP2006 and returns false when the
  // expression is not a compile-time constant.
  bool fold_field(const Field& field, const ParamScope& scope, const std::string& context,
                  Value& out) {
    if (!fold_value(field.value, scope, out) || !is_scalar(out)) {
      error("LP2006",
            context +
                " must be a compile-time constant (literals, params, "
                "arithmetic)",
            field.span);
      return false;
    }
    return true;
  }

  void check_distribution(const Distribution& dist, const std::string& context) {
    for (const double param : dist.params) {
      if (!(param > 0.0)) {
        error("LP3001",
              context + ": distribution parameter must be > 0 (got " + std::to_string(param) + ")",
              dist.span);
        return;  // one diagnostic per distribution
      }
    }
  }

  // ------------------------------------------------------------------
  // Process library blocks (registry-driven shapes + C++ semantic rules)
  // ------------------------------------------------------------------

  // Validate a process library block instance against its registered shape
  // (required params, known fields, duplicates, param types) plus the
  // kind-specific semantic rules below.
  void check_process_block(const Node& node, const ParamScope& scope) {
    if (registry_ == nullptr) {
      return;
    }
    for (const VarDecl& var : node.vars) {
      // `state <name> = <value>` inside a source declares the entity
      // attribute defaults every emitted agent carries (AnyLogic agent
      // fields); other process blocks cannot declare state.
      if (node.kind == "source" && var.keyword == "state") {
        continue;
      }
      error("LP2005",
            "'" + var.keyword + "' is not allowed in " + node.kind + " '" + node.name + "'",
            var.span);
    }
    if (node.kind == "source") {
      validate_entity_attributes(node, scope);
    }
    const BlockShape* shape = registry_->resolve(node.registry_key());
    if (shape == nullptr) {
      const BlockShape* own = registry_->block(node.registry_key());
      if (own != nullptr && !own->extends_kind.empty()) {
        error("LP2011",
              "block '" + node.kind + "' extends unknown block '" + own->extends_kind + "'",
              node.span);
      }
      return;  // unknown kind is reported by check_decl
    }
    for (const BlockParamSpec& spec : shape->params) {
      if (spec.required && field_of(node, spec.name.c_str()) == nullptr) {
        error("LP2001",
              "missing required field '" + spec.name + "' in " + node.kind + " '" + node.name + "'",
              node.span);
      }
    }
    std::unordered_set<std::string> duplicate_reported;
    for (const Field& field : node.fields) {
      const BlockParamSpec* spec = shape->param(field.name);
      if (spec == nullptr) {
        error("LP2005",
              "unknown field '" + field.name + "' in " + node.kind + " '" + node.name + "'",
              field.name_span);
        continue;
      }
      if (field_count(node, field.name) > 1 && duplicate_reported.insert(field.name).second) {
        const Field* last = nullptr;
        for (const Field& candidate : node.fields) {
          if (candidate.name == field.name) {
            last = &candidate;
          }
        }
        error("LP1002",
              "duplicate field '" + field.name + "' in " + node.kind + " '" + node.name + "'",
              last ? last->span : node.span);
      }
      check_param_type(node, *spec, field, scope);
    }
    check_block_semantics(node, scope);
  }

  void check_param_type(const Node& node, const BlockParamSpec& spec, const Field& field,
                        const ParamScope& scope) {
    const std::string context = node.kind + " '" + node.name + "' " + spec.name;
    switch (spec.type) {
      case BlockParamType::kInt: {
        Value folded;
        if (fold_field(field, scope, context, folded) && folded.kind != ValueKind::kInt) {
          error("LP3001", context + " must be an integer", field.span);
        }
        break;
      }
      case BlockParamType::kFloat: {
        Value folded;
        if (fold_field(field, scope, context, folded) && folded.kind != ValueKind::kInt &&
            folded.kind != ValueKind::kFloat) {
          error("LP3001", context + " must be a number", field.span);
        }
        break;
      }
      case BlockParamType::kDistribution:
        check_distribution_field(field, scope, context);
        break;
      case BlockParamType::kRef:
      case BlockParamType::kBool:
      case BlockParamType::kString:
      case BlockParamType::kExpression:
      case BlockParamType::kUnknown:
        break;  // references resolved in check_block_semantics
    }
  }

  // Kind-specific semantic rules on top of the registered shape (range
  // checks and the service resource reference).
  // Runtime condition expressions are evaluated by the kernel with
  // `t`/`time` and the block's own numeric fields in scope; anything else
  // is a silent 0.0 at runtime, so unknown identifiers are rejected here.
  void check_runtime_expression(const Node& node, const Field* condition) {
    if (condition == nullptr || value_is_constant(condition->value)) {
      return;
    }
    std::unordered_set<std::string> known = {"t", "time"};
    for (const std::string& attribute : entity_attribute_names_) {
      known.insert(attribute);
    }
    for (const Field& field : node.fields) {
      if (field.value.kind == ValueKind::kInt || field.value.kind == ValueKind::kFloat) {
        known.insert(field.name);
      }
    }
    std::vector<std::string> unknown;
    collect_unknown_identifiers(condition->value, known, unknown);
    for (const std::string& id : unknown) {
      error("LP5006",
            "condition '" + condition->name + "' in " + node.kind + " '" + node.name +
                "' references unknown identifier '" + id +
                "' (expected 't'/'time' or a numeric block field)",
            condition->span);
    }
  }

  void check_pair_expression(const Node& node, const Field& condition,
                             const Value& value) {
    if (value.kind == ValueKind::kField && value.operands.size() == 2) {
      const Value& base = value.operands[0];
      const Value& member = value.operands[1];
      const bool valid_base = base.kind == ValueKind::kIdentifier &&
                              (base.string_value == "agent1" ||
                               base.string_value == "agent2");
      if (!valid_base || member.kind != ValueKind::kIdentifier) {
        error("LP5006",
              "comparison '" + condition.name + "' in " + node.kind + " '" +
                  node.name + "' must use agent1.<attribute> or agent2.<attribute>",
              value.span);
        return;
      }
      if (entity_attribute_names_.count(member.string_value) == 0) {
        error("LP5006",
              "comparison '" + condition.name + "' in " + node.kind + " '" +
                  node.name + "' references unknown entity attribute '" +
                  member.string_value + "'",
              value.span);
      }
      return;
    }
    if (value.kind == ValueKind::kIdentifier) {
      error("LP5006",
            "comparison '" + condition.name + "' in " + node.kind + " '" +
                node.name + "' references unsupported identifier '" +
                value.string_value + "'",
            value.span);
      return;
    }
    for (const Value& operand : value.operands) {
      check_pair_expression(node, condition, operand);
    }
    for (const Value& argument : value.call_args) {
      check_pair_expression(node, condition, argument);
    }
  }

  void check_block_semantics(const Node& node, const ParamScope& scope) {
    const auto check_int_min = [&](const char* field_name, std::int64_t minimum) {
      const Field* field = field_of(node, field_name);
      if (field == nullptr) {
        return;
      }
      Value folded;
      if (fold_value(field->value, scope, folded) &&
          folded.kind == ValueKind::kInt && folded.int_value < minimum) {
        error("LP3001",
              node.kind + " '" + node.name + "' " + field_name +
                  " must be >= " + std::to_string(minimum) + " (got " +
                  std::to_string(folded.int_value) + ")",
              field->span);
      }
    };
    const auto check_positive_number = [&](const char* field_name) {
      const Field* field = field_of(node, field_name);
      if (field == nullptr) {
        return;
      }
      Value folded;
      if (fold_value(field->value, scope, folded) &&
          (folded.kind == ValueKind::kInt ||
           folded.kind == ValueKind::kFloat) &&
          folded_double(folded) <= 0.0) {
        error("LP3001",
              node.kind + " '" + node.name + "' " + field_name +
                  " must be > 0 (got " +
                  std::to_string(folded_double(folded)) + ")",
              field->span);
      }
    };
    if (node.kind == "selectOutput" || node.kind == "hold") {
      // Runtime conditions (selectOutput.condition / hold.blockingCondition).
      const char* field_name = node.kind == "selectOutput" ? "condition" : "blockingCondition";
      check_runtime_expression(node, field_of(node, field_name));
    }
    if (node.kind == "selectOutput5" || node.kind == "selectOutputOut") {
      // SelectOutput5/SelectOutputOut routing conditions.
      for (const char* field_name :
           {"condition1", "condition2", "condition3", "condition4", "condition5"}) {
        check_runtime_expression(node, field_of(node, field_name));
      }
    }
    if (node.kind == "selectOutputIn") {
      // SelectOutputIn explicit choice expression (1-based exit index).
      check_runtime_expression(node, field_of(node, "choice"));
    }
    if (node.kind == "match") {
      const Field* condition = field_of(node, "matchCondition");
      if (condition != nullptr && !value_is_constant(condition->value)) {
        // Match conditions may reference `agent1`/`agent2` attribute fields
        // (`agent1.kind == agent2.kind`) or a bare attribute name.
        std::unordered_set<std::string> known = {"t", "time", "agent1", "agent2"};
        for (const std::string& attribute : entity_attribute_names_) {
          known.insert(attribute);
        }
        std::vector<std::string> unknown;
        collect_unknown_identifiers(condition->value, known, unknown);
        for (const std::string& id : unknown) {
          error("LP5006",
                "matchCondition in match '" + node.name + "' references unknown identifier '" + id +
                    "' (expected agent1/agent2 attribute fields, an "
                    "entity attribute, or t/time)",
                condition->span);
        }
      }
    }
    if (node.kind == "source") {
      check_int_min("agentsPerArrival", 1);
      check_int_min("maxArrivals", 0);
      const Field* first = field_of(node, "firstArrivalTime");
      if (first != nullptr) {
        Value folded;
        if (fold_value(first->value, scope, folded) &&
            (folded.kind == ValueKind::kInt ||
             folded.kind == ValueKind::kFloat) &&
            folded_double(folded) < 0.0) {
          error("LP3001",
                "source '" + node.name +
                    "' firstArrivalTime must be >= 0 (got " +
                    std::to_string(folded_double(folded)) + ")",
                first->span);
        }
      }
      return;
    }
    if (node.kind == "resource") {
      const Field* capacity = field_of(node, "capacity");
      if (capacity) {
        Value folded;
        if (fold_value(capacity->value, scope, folded) && folded.kind == ValueKind::kInt &&
            folded.int_value < 1) {
          error("LP3001",
                "resource '" + node.name + "' capacity must be >= 1 (got " +
                    std::to_string(folded.int_value) + ")",
                capacity->span);
        }
      }
      const Field* failure_rate = field_of(node, "failure_rate");
      if (failure_rate) {
        Value folded;
        if (fold_value(failure_rate->value, scope, folded) &&
            (folded.kind == ValueKind::kInt || folded.kind == ValueKind::kFloat)) {
          const double value = folded_double(folded);
          if (value < 0.0) {
            error("LP3001",
                  "resource '" + node.name + "' failure_rate must be >= 0 (got " +
                      std::to_string(value) + ")",
                  failure_rate->span);
          }
        }
      }
      check_positive_number("repair_rate");
      return;
    }
    if (node.kind == "queue") {
      const Field* capacity = field_of(node, "capacity");
      if (capacity) {
        Value folded;
        if (fold_value(capacity->value, scope, folded) && folded.kind == ValueKind::kInt &&
            folded.int_value < 0) {
          error("LP3001",
                "queue '" + node.name + "' capacity must be >= 0 (got " +
                    std::to_string(folded.int_value) + ")",
                capacity->span);
        }
      }
      const Field* queuing = field_of(node, "queuing");
      std::string mode = "queuing_fifo";
      if (queuing != nullptr) {
        if (queuing->value.kind == ValueKind::kIdentifier ||
            queuing->value.kind == ValueKind::kString) {
          mode = queuing->value.string_value;
        } else {
          error("LP3001", "queue '" + node.name +
                              "' queuing must be an identifier or string",
                queuing->span);
        }
      }
      const bool known_mode =
          mode == "queuing_fifo" || mode == "queuing_lifo" ||
          mode == "queuing_priority" || mode == "queuing_comparison";
      if (!known_mode) {
        error("LP3001",
              "queue '" + node.name + "' queuing must be "
                  "queuing_fifo/queuing_lifo/queuing_priority/"
                  "queuing_comparison (got '" + mode + "')",
              queuing != nullptr ? queuing->span : node.span);
      }
      const Field* comparison =
          field_of(node, "agent1IsPreferredToAgent2");
      if (mode == "queuing_comparison" && comparison == nullptr) {
        error("LP2001",
              "queue '" + node.name +
                  "' with queuing_comparison requires "
                  "agent1IsPreferredToAgent2",
              node.span);
      } else if (comparison != nullptr) {
        check_pair_expression(node, *comparison, comparison->value);
      }
      check_positive_number("timeout");
      return;
    }
    if (node.kind == "service") {
      check_int_min("numberOfUnits", 1);
      check_int_min("queueCapacity", 0);
      check_positive_number("timeout");
      const Field* resource = field_of(node, "resource");
      if (resource != nullptr) {
        if (resource->value.kind == ValueKind::kIdentifier) {
          if (!resource_declared(resource->value.string_value)) {
            error("LP4001",
                  "service '" + node.name +
                      "' references undeclared "
                      "resource '" +
                      resource->value.string_value + "'",
                  resource->value.span);
          }
        } else {
          error("LP4001",
                "service '" + node.name +
                    "' resource must reference a declared resource "
                    "(identifier)",
                resource->span);
        }
      } else if (!resource_declared(node.name)) {
        error("LP4001",
              "service '" + node.name + "' references undeclared resource '" + node.name + "'",
              node.name_span);
      }
    }
  }

  // Entity attributes declared on source blocks: every emitted agent carries
  // them, so runtime conditions (selectOutput/hold) may reference them.
  void collect_entity_attributes(const std::vector<Node>& members) {
    for (const Node& member : members) {
      if (member.kind == "source") {
        for (const VarDecl& var : member.vars) {
          if (var.keyword == "state") {
            entity_attribute_names_.insert(var.name);
          }
        }
      }
      collect_entity_attributes(member.children);
    }
  }

  void validate_entity_attributes(const Node& node, const ParamScope& scope) {
    std::unordered_map<std::string, Span> names;
    for (const VarDecl& var : node.vars) {
      if (var.keyword != "state") {
        continue;
      }
      const auto [it, inserted] = names.emplace(var.name, var.name_span);
      if (!inserted) {
        error("LP1002",
              "duplicate entity attribute '" + var.name + "' in source '" + node.name + "'",
              var.name_span);
      }
      Value folded;
      if (!fold_value(var.value, scope, folded) || !is_scalar(folded)) {
        error("LP2006",
              "entity attribute '" + var.name + "' in source '" + node.name +
                  "' must be a compile-time constant (literals, params, "
                  "arithmetic)",
              var.span);
      }
    }
  }

  void check_distribution_field(const Field& field, const ParamScope& scope,
                                const std::string& context) {
    Value folded;
    if (!fold_value(field.value, scope, folded)) {
      error("LP2006",
            context +
                " must be a compile-time constant (literals, params, "
                "arithmetic)",
            field.span);
      return;
    }
    Distribution dist;
    if (!distribution_from_value(folded, dist)) {
      error("LP3001",
            context +
                ": expected poisson/rate/exponential/normal/"
                "constant(...)",
            field.span);
      return;
    }
    check_distribution(dist, context);
  }

  // Validate a scope that holds process-library members (model root or an
  // agent body): at least one source, and every coupling checked against the
  // registered block shapes (port existence, direction, visibility).
  void check_flow_scope(const std::vector<Node>& members, const std::vector<CoupleDecl>& couplings,
                        const std::string& scope_name, const Span& span) {
    if (registry_ == nullptr) {
      return;
    }
    std::unordered_map<std::string, const Node*> stages;
    int sources = 0;
    for (const Node& member : members) {
      const BlockShape* semantic_shape = registry_->resolve(member.registry_key());
      if (semantic_shape == nullptr || semantic_shape->library != "process" ||
          member.kind == "resource") {
        continue;
      }
      stages.emplace(member.name, &member);
      if (member.kind == "source") {
        ++sources;
      }
    }
    if (stages.empty()) {
      return;  // no flow members in this scope
    }
    if (sources == 0) {
      error("LP2002", scope_name + " has no source stage", span);
    }
    // LP5004: with an explicit coupling graph, every non-source stage must
    // have at least one incoming coupling - otherwise it can never receive
    // an entity (the engine routes only by the coupling graph).
    if (!couplings.empty() && sources > 0) {
      std::unordered_set<std::string> targets;
      for (const CoupleDecl& couple : couplings) {
        if (stages.count(couple.from_model) > 0 && stages.count(couple.to_model) > 0) {
          targets.insert(couple.to_model);
        }
      }
      for (const auto& [name, stage] : stages) {
        // SelectOutputOut blocks are pure routing targets: agents reach them
        // logically from their associated SelectOutputIn, never by coupling.
        if (stage->kind != "source" && stage->kind != "selectOutputOut" &&
            targets.count(name) == 0) {
          error("LP5004",
                "process stage '" + name + "' in " + scope_name +
                    " has no incoming coupling and can never receive an "
                    "entity",
                stage->span);
        }
      }
    }
    for (const CoupleDecl& couple : couplings) {
      const auto from = stages.find(couple.from_model);
      const auto to = stages.find(couple.to_model);
      if (from == stages.end() || to == stages.end()) {
        // Couplings to non-process members (atomics, agents) are validated
        // by check_couplings; unknown names are reported there too.
        continue;
      }
      check_process_coupling(*from->second, *to->second, couple);
    }
  }

  bool resource_declared(const std::string& name) const {
    return declared_resources_.count(name) > 0;
  }

  // ------------------------------------------------------------------
  // atomic / agent / continuous
  // ------------------------------------------------------------------

  void check_state_vars(const Node& node, const ParamScope& scope) {
    std::unordered_map<std::string, Span> state_names;
    for (const VarDecl& var : node.vars) {
      if (var.keyword != "state") {
        continue;
      }
      const auto [it, inserted] = state_names.emplace(var.name, var.name_span);
      if (!inserted) {
        error(
            "LP1002",
            "duplicate state variable '" + var.name + "' in " + node.kind + " '" + node.name + "'",
            var.name_span);
      }
      Value folded;
      if (!fold_value(var.value, scope, folded) || !is_scalar(folded)) {
        error("LP2006",
              "state '" + var.name + "' in " + node.kind + " '" + node.name +
                  "' must be a compile-time constant (literals, params, "
                  "arithmetic)",
              var.span);
      }
    }
  }

  void check_effects(const Node& node, const ParamScope& scope,
                     const std::vector<Effect>& effects) {
    for (const Effect& effect : effects) {
      if (effect.kind != Effect::Kind::kAssign) {
        continue;
      }
      bool declared = false;
      for (const VarDecl& var : node.vars) {
        if (var.name == effect.name) {
          declared = true;
          break;
        }
      }
      if (!declared) {
        error("LP5001",
              "effect references undeclared state variable '" + effect.name + "' in atomic '" +
                  node.name + "'",
              effect.name_span);
        continue;
      }
      Value folded;
      if (!fold_value(effect.value, scope, folded) || !is_scalar(folded)) {
        error("LP2006",
              "effect '" + effect.name + "' in atomic '" + node.name +
                  "' must be a compile-time constant (literals, params, "
                  "arithmetic)",
              effect.value.span);
      }
    }
  }

  void check_atomic(const Node& node, const ParamScope& scope) {
    check_shape(node, {"time_advance"}, {"state"});
    check_state_vars(node, scope);
    const Field* ta = field_of(node, "time_advance");
    check_duplicate(node, "time_advance");
    if (ta) {
      const Value& value = ta->value;
      if (value.kind == ValueKind::kIdentifier && value.string_value == "infinite") {
        // passive atomic: no time advance
      } else {
        Value folded;
        if (!fold_value(value, scope, folded)) {
          error("LP2006",
                "atomic '" + node.name +
                    "' time_advance must be a compile-time constant "
                    "(literals, params, arithmetic)",
                ta->span);
        } else if (folded.kind == ValueKind::kCall && folded.call_name == "exponential" &&
                   folded.call_args.size() == 1 &&
                   (folded.call_args[0].kind == ValueKind::kInt ||
                    folded.call_args[0].kind == ValueKind::kFloat)) {
          if (!(folded_double(folded.call_args[0]) > 0.0)) {
            error("LP3001", "atomic '" + node.name + "' time_advance exponential rate must be > 0",
                  ta->span);
          }
        } else if (folded.kind == ValueKind::kCall && folded.call_name == "constant" &&
                   folded.call_args.size() == 1 &&
                   (folded.call_args[0].kind == ValueKind::kInt ||
                    folded.call_args[0].kind == ValueKind::kFloat)) {
          if (folded_double(folded.call_args[0]) < 0.0) {
            error("LP3001",
                  "atomic '" + node.name + "' time_advance must be >= 0 (got " +
                      std::to_string(folded_double(folded.call_args[0])) + ")",
                  ta->span);
          }
        } else if (folded.kind == ValueKind::kInt || folded.kind == ValueKind::kFloat) {
          if (folded_double(folded) < 0.0) {
            error("LP3001",
                  "atomic '" + node.name + "' time_advance must be >= 0 (got " +
                      std::to_string(folded_double(folded)) + ")",
                  ta->span);
          }
        } else {
          error("LP3001",
                "atomic '" + node.name +
                    "' time_advance must be a number, constant(...), "
                    "exponential(...) or infinite",
                ta->span);
        }
      }
    }
    std::vector<const Behavior*> on_input;
    const Behavior* on_timeout = nullptr;
    for (const Behavior& behavior : node.behaviors) {
      if (behavior.trigger == "input") {
        on_input.push_back(&behavior);
      } else if (behavior.trigger == "timeout") {
        if (on_timeout != nullptr) {
          error("LP1002", "duplicate 'on_timeout' in atomic '" + node.name + "'", behavior.span);
        }
        on_timeout = &behavior;
      } else {
        error("LP2004",
              "unknown behavior trigger 'on_" + behavior.trigger + "' in atomic '" + node.name +
                  "' (expected on_input / on_timeout)",
              behavior.span);
      }
    }
    // v1 IR (F1) constraint: a single external transition (one input port)
    // and a single internal transition.
    if (on_input.size() > 1) {
      error("LP2003",
            "atomic '" + node.name +
                "' supports at most one on_input transition in v1 (F1 IR "
                "constraint)",
            on_input[1]->span);
    }
    for (const Behavior* behavior : on_input) {
      check_effects(node, scope, behavior->effects);
    }
    if (on_timeout != nullptr) {
      check_effects(node, scope, on_timeout->effects);
    }
  }

  // Kernel-built-in agent behavior handlers (v0.1 registry; the runtime
  // implements exactly these, see kernel/src/devs/ir_agent.cpp).
  bool known_handler(const std::string& handler) const {
    return handler == "noop" || handler == "flip" || handler == "bounce";
  }

  void check_agent(const Node& node, const ParamScope& scope) {
    check_shape(node, {"count"}, {"state"});
    check_state_vars(node, scope);
    const Field* count = field_of(node, "count");
    check_missing(node, "count", count);
    check_duplicate(node, "count");
    if (count) {
      Value folded;
      if (fold_field(*count, scope, "agent '" + node.name + "' count", folded)) {
        if (folded.kind != ValueKind::kInt) {
          error("LP3001", "agent '" + node.name + "' count must be an integer", count->span);
        } else if (folded.int_value < 1) {
          error("LP3001",
                "agent '" + node.name + "' count must be >= 1 (got " +
                    std::to_string(folded.int_value) + ")",
                count->span);
        }
      }
    }
    // Agent-centric members: process-library blocks (flows, resources) and
    // nested agents live directly in the agent body. Register agent-level
    // resources so service/seize references resolve, then validate the
    // agent's flow scope (source + couplings).
    for (const Node& child : node.children) {
      if (child.kind == "resource") {
        declared_resources_.insert(child.name);
      }
    }
    for (const Node& child : node.children) {
      check_decl(child, false, scope);
    }
    check_flow_scope(node.children, node.couplings, "agent '" + node.name + "'", node.span);
    for (const Behavior& behavior : node.behaviors) {
      if (behavior.trigger != "tick") {
        error("LP6001",
              "unknown agent behavior trigger 'on_" + behavior.trigger + "' in agent '" +
                  node.name + "' (v0.1 registry: on_tick)",
              behavior.span);
        continue;
      }
      for (const Effect& effect : behavior.effects) {
        if (effect.kind != Effect::Kind::kCall) {
          error("LP2004",
                "only call effects (e.g. flip <state>) are allowed in "
                "agent behaviors",
                behavior.span);
          continue;
        }
        if (!known_handler(effect.name)) {
          error("LP6001",
                "unknown agent behavior handler '" + effect.name + "' in agent '" + node.name +
                    "' (v0.1 registry: noop, flip <state>, bounce)",
                effect.name_span);
          continue;
        }
        if (effect.name == "flip") {
          if (effect.arg.empty()) {
            error("LP6002",
                  "'flip' in agent '" + node.name + "' requires a state-variable argument",
                  effect.name_span);
          } else {
            bool declared_bool = false;
            for (const VarDecl& var : node.vars) {
              if (var.name == effect.arg && var.value.kind == ValueKind::kBool) {
                declared_bool = true;
                break;
              }
            }
            if (!declared_bool) {
              error("LP6002",
                    "'flip' argument '" + effect.arg + "' in agent '" + node.name +
                        "' is not a declared bool state variable",
                    effect.arg_span);
            }
          }
        } else if (!effect.arg.empty()) {
          error("LP6002",
                "behavior '" + effect.name + "' in agent '" + node.name + "' takes no argument",
                effect.arg_span);
        }
      }
    }
  }

  void check_continuous(const Node& node, const ParamScope& scope) {
    check_shape(node, {}, {"state", "param"});
    std::unordered_map<std::string, Span> names;
    const auto reserved = [&](const std::string& name, const Span& span) {
      if (name == "t") {
        error("LP8002", "'t' is reserved for simulation time in continuous '" + node.name + "'",
              span);
      }
    };
    for (const VarDecl& var : node.vars) {
      reserved(var.name, var.name_span);
      const auto [it, inserted] = names.emplace(var.name, var.name_span);
      if (!inserted) {
        error("LP1002", "duplicate variable '" + var.name + "' in continuous '" + node.name + "'",
              var.name_span);
      }
    }
    check_state_vars(node, scope);
    if (node.equations.empty()) {
      error("LP2001",
            "continuous '" + node.name + "' requires at least one equation (d <var>/dt = ...)",
            node.span);
      return;
    }
    for (const Equation& equation : node.equations) {
      bool declared = false;
      for (const VarDecl& var : node.vars) {
        if (var.keyword == "state" && var.name == equation.var) {
          declared = true;
          break;
        }
      }
      if (!declared) {
        error("LP8001",
              "equation lhs '" + equation.var + "' in continuous '" + node.name +
                  "' must reference a declared state variable",
              equation.span);
      }
    }
  }

  // ------------------------------------------------------------------
  // experiment / couplings
  // ------------------------------------------------------------------

  bool known_metric(const std::string& metric) const {
    return metric == "throughput" || metric == "Wq" || metric == "W" ||
           metric == "Lq" || metric == "L" || metric == "measure" ||
           metric == "utilization" || metric == "availability" ||
           metric == "final_value";
  }

  void check_experiment(const ExperimentDecl& experiment,
                        const std::unordered_map<std::string, std::string>& model_param_types) {
    for (const Field& field : experiment.unknown_fields) {
      error("LP2005",
            "unknown field '" + field.name + "' in experiment '" +
                experiment.name + "'",
            field.span);
    }
    const auto duplicate = [&](int count, const char* field_name, const Span& span) {
      if (count > 1) {
        error("LP1002",
              "duplicate field '" + std::string(field_name) + "' in experiment '" +
                  experiment.name + "'",
              span);
      }
    };
    duplicate(experiment.kind_count, "type", experiment.kind_span);
    duplicate(experiment.objective_count, "objective", experiment.objective_span);
    duplicate(experiment.metric_count, "metric", experiment.metric_span);
    duplicate(experiment.variable_count, "variable", experiment.variable_span);
    duplicate(experiment.range_count, "range", experiment.range_span);
    duplicate(experiment.budget_count, "budget", experiment.budget_span);
    duplicate(experiment.replications_count, "replications",
              experiment.replications_span);
    duplicate(experiment.seed_count, "seed", experiment.seed_span);
    duplicate(experiment.seed_mode_count, "seed_mode", experiment.seed_mode_span);
    duplicate(experiment.replication_mode_count, "replication_mode",
              experiment.replication_mode_span);
    duplicate(experiment.min_replications_count, "min_replications",
              experiment.min_replications_span);
    duplicate(experiment.max_replications_count, "max_replications",
              experiment.max_replications_span);
    duplicate(experiment.confidence_count, "confidence", experiment.confidence_span);
    duplicate(experiment.error_percent_count, "error_percent",
              experiment.error_percent_span);

    if (experiment.kind_count > 0 && !experiment.has_kind) {
      error("LP2006",
            "experiment '" + experiment.name +
                "' type must be an identifier",
            experiment.kind_span);
    }
    const bool has_optimization_fields =
        experiment.objective_count > 0 || experiment.variable_count > 0 ||
        experiment.range_count > 0 ||
        experiment.budget_count > 0;
    const std::string kind = experiment.has_kind
                                 ? experiment.kind
                                 : (!experiment.axes.empty()
                                        ? "parameter_variation"
                                        : (has_optimization_fields ? "optimization"
                                                                   : "simulation"));
    if (kind != "simulation" && kind != "optimization" &&
        kind != "parameter_variation") {
      error("LP7001",
            "experiment '" + experiment.name +
                "' type must be simulation/optimization/parameter_variation (got '" +
                kind + "')",
            experiment.kind_span);
    }

    const auto required = [&](bool has, const char* field_name) {
      if (!has) {
        error("LP2001",
              "missing required field '" + std::string(field_name) + "' in experiment '" +
                  experiment.name + "'",
              experiment.span);
      }
    };
    if (kind == "optimization") {
      required(experiment.has_objective, "objective");
      required(experiment.has_metric, "metric");
      required(experiment.has_variable, "variable");
      required(experiment.has_range, "range");
      if (!experiment.axes.empty()) {
        error("LP7001", "optimization experiment '" + experiment.name +
                            "' cannot declare axis blocks", experiment.span);
      }
    } else if (kind == "parameter_variation") {
      required(experiment.has_metric, "metric");
      if (experiment.axes.empty()) {
        error("LP2001", "parameter variation experiment '" + experiment.name +
                            "' requires at least one axis", experiment.span);
      }
      if (experiment.objective_count > 0 || experiment.variable_count > 0 ||
          experiment.range_count > 0 || experiment.budget_count > 0) {
        error("LP7001", "parameter variation experiment '" + experiment.name +
                            "' uses axis blocks instead of objective/variable/range/budget",
              experiment.span);
      }
    } else if (has_optimization_fields || !experiment.axes.empty()) {
      error("LP7001",
            "simulation experiment '" + experiment.name +
                "' cannot declare objective/variable/range/budget",
            experiment.span);
    }

    const bool precision = experiment.replication_mode == "precision";
    if (experiment.seed_mode_count > 0 && !experiment.has_seed_mode) {
      error("LP2006", "experiment '" + experiment.name +
                          "' seed_mode must be an identifier",
            experiment.seed_mode_span);
    }
    if (experiment.replication_mode_count > 0 &&
        !experiment.has_replication_mode) {
      error("LP2006", "experiment '" + experiment.name +
                          "' replication_mode must be an identifier",
            experiment.replication_mode_span);
    }
    if (experiment.seed_mode != "fixed" && experiment.seed_mode != "random") {
      error("LP7001", "experiment '" + experiment.name +
                          "' seed_mode must be 'fixed' or 'random'",
            experiment.seed_mode_span);
    }
    if (experiment.replication_mode != "fixed" &&
        experiment.replication_mode != "precision") {
      error("LP7001", "experiment '" + experiment.name +
                          "' replication_mode must be 'fixed' or 'precision'",
            experiment.replication_mode_span);
    }
    if (precision && !experiment.has_metric) {
      error("LP2001", "precision experiment '" + experiment.name +
                          "' requires metric",
            experiment.span);
    }
    if (kind == "simulation" && experiment.has_metric && !precision) {
      error("LP7001", "simulation experiment '" + experiment.name +
                          "' metric is only valid with replication_mode = precision",
            experiment.metric_span);
    }

    std::unordered_set<std::string> axis_names;
    std::unordered_set<std::string> axis_variables;
    std::size_t combinations = 1;
    for (const VariationAxis& axis : experiment.axes) {
      if (!axis_names.insert(axis.name).second) {
        error("LP1002", "duplicate axis '" + axis.name + "' in experiment '" +
                            experiment.name + "'", axis.name_span);
      }
      for (const Field& field : axis.unknown_fields) {
        error("LP2005", "unknown field '" + field.name + "' in axis '" +
                            axis.name + "'", field.span);
      }
      if (axis.variable_count > 1) {
        error("LP1002", "duplicate field 'variable' in axis '" + axis.name + "'",
              axis.variable_span);
      }
      if (axis.range_count > 1) {
        error("LP1002", "duplicate field 'range' in axis '" + axis.name + "'",
              axis.range_span);
      }
      if (axis.step_count > 1) {
        error("LP1002", "duplicate field 'step' in axis '" + axis.name + "'",
              axis.step_span);
      }
      if (!axis.has_variable) {
        error("LP2001", "axis '" + axis.name + "' requires variable",
              axis.span);
      } else if (!model_param_types.count(axis.variable)) {
        error("LP7001", "axis '" + axis.name + "' variable '" + axis.variable +
                            "' must reference a top-level model param",
              axis.variable_span);
      } else if (!axis_variables.insert(axis.variable).second) {
        error("LP1002", "parameter '" + axis.variable +
                            "' is varied by more than one axis", axis.variable_span);
      }
      if (!axis.has_range) {
        error("LP2001", "axis '" + axis.name + "' requires range", axis.span);
      }
      if (!axis.has_step) {
        error("LP2001", "axis '" + axis.name + "' requires step", axis.span);
      }
      if (!(std::isfinite(axis.range_min) && std::isfinite(axis.range_max)) ||
          axis.range_max < axis.range_min) {
        error("LP3001", "axis '" + axis.name +
                            "' range must have finite min <= max", axis.range_span);
      }
      if (!(std::isfinite(axis.step) && axis.step > 0.0)) {
        error("LP3001", "axis '" + axis.name + "' step must be > 0",
              axis.step_span);
      } else if (axis.range_max >= axis.range_min) {
        const auto count = static_cast<std::size_t>(
            std::floor((axis.range_max - axis.range_min) / axis.step + 1e-9)) + 1;
        if (count > 100000 || combinations > 100000 / std::max<std::size_t>(count, 1)) {
          error("LP3001", "parameter variation experiment '" + experiment.name +
                              "' exceeds 100000 combinations", experiment.span);
        } else {
          combinations *= count;
        }
      }
      const auto param_type = model_param_types.find(axis.variable);
      if (param_type != model_param_types.end()) {
        if (param_type->second != "int" && param_type->second != "float") {
          error("LP7001", "axis '" + axis.name + "' variable '" + axis.variable +
                              "' must be a numeric model param",
                axis.variable_span);
        } else if (param_type->second == "int" &&
                   (std::trunc(axis.range_min) != axis.range_min ||
                    std::trunc(axis.range_max) != axis.range_max ||
                    std::trunc(axis.step) != axis.step)) {
          error("LP3001", "axis '" + axis.name +
                              "' for an int param requires integer range bounds and step",
                axis.span);
        }
      }
    }

    // Phase D: experiment numeric fields stay literal-only for now.
    if (experiment.budget_count > 0 && !experiment.has_budget) {
      error("LP2006", "experiment '" + experiment.name + "' budget must be an integer literal",
            experiment.budget_span);
    }
    if (experiment.replications_count > 0 && !experiment.has_replications) {
      error("LP2006",
            "experiment '" + experiment.name +
                "' replications must be an integer literal",
            experiment.replications_span);
    }
    if (experiment.seed_count > 0 && !experiment.has_seed) {
      error("LP2006",
            "experiment '" + experiment.name +
                "' seed must be an integer literal",
            experiment.seed_span);
    }
    const auto require_integer = [&](int count, bool has, const char* name,
                                     const Span& span) {
      if (count > 0 && !has) {
        error("LP2006", "experiment '" + experiment.name + "' " + name +
                            " must be an integer literal", span);
      }
    };
    require_integer(experiment.min_replications_count,
                    experiment.has_min_replications, "min_replications",
                    experiment.min_replications_span);
    require_integer(experiment.max_replications_count,
                    experiment.has_max_replications, "max_replications",
                    experiment.max_replications_span);
    if (experiment.confidence_count > 0 && !experiment.has_confidence) {
      error("LP2006", "experiment '" + experiment.name +
                          "' confidence must be a numeric literal",
            experiment.confidence_span);
    }
    if (experiment.error_percent_count > 0 && !experiment.has_error_percent) {
      error("LP2006", "experiment '" + experiment.name +
                          "' error_percent must be a numeric literal",
            experiment.error_percent_span);
    }

    if (experiment.has_objective && experiment.objective != "maximize" &&
        experiment.objective != "minimize") {
      error("LP7001",
            "experiment '" + experiment.name +
                "' objective must be "
                "'maximize' or 'minimize' (got '" +
                experiment.objective + "')",
            experiment.objective_span);
    }
    if (experiment.has_metric && !known_metric(experiment.metric)) {
      error("LP7001",
            "experiment '" + experiment.name +
                "' metric must be one of "
                "throughput/Wq/W/Lq (got '" +
                experiment.metric + "')",
            experiment.metric_span);
    }
    // Phase E: the optimizable variable must be a declared model param or
    // the v0.1 `servers` slot (resource capacity), which the optimization
    // tooling substitutes by text.
    if (experiment.has_variable && experiment.variable != "servers" &&
        !model_param_types.count(experiment.variable)) {
      error("LP7001",
            "experiment '" + experiment.name + "' variable '" + experiment.variable +
                "' must reference a declared model param or 'servers'",
            experiment.variable_span);
    }
    if (experiment.has_range &&
        (experiment.range_min < 1 || experiment.range_max < experiment.range_min)) {
      error("LP3001",
            "experiment '" + experiment.name +
                "' range must satisfy "
                "1 <= min <= max (got " +
                std::to_string(experiment.range_min) + ".." + std::to_string(experiment.range_max) +
                ")",
            experiment.range_span);
    }
    if (experiment.has_budget && experiment.budget < 1) {
      error("LP3001", "experiment '" + experiment.name + "' budget must be >= 1",
            experiment.budget_span);
    }
    if (experiment.has_replications && experiment.replications < 1) {
      error("LP3001",
            "experiment '" + experiment.name+
                "' replications must be >= 1",
            experiment.replications_span);
    }
    if (experiment.has_seed && experiment.seed < 0) {
      error("LP3001", "experiment '" + experiment.name +
                          "' seed must be >= 0",
            experiment.seed_span);
    }
    if (precision && experiment.min_replications < 2) {
      error("LP3001", "experiment '" + experiment.name +
                          "' min_replications must be >= 2",
            experiment.min_replications_span);
    }
    if (precision && experiment.max_replications < experiment.min_replications) {
      error("LP3001", "experiment '" + experiment.name +
                          "' max_replications must be >= min_replications",
            experiment.max_replications_span);
    }
    if (!(experiment.confidence > 0.0 && experiment.confidence < 1.0)) {
      error("LP3001", "experiment '" + experiment.name +
                          "' confidence must be between 0 and 1",
            experiment.confidence_span);
    }
    if (!(experiment.error_percent > 0.0)) {
      error("LP3001", "experiment '" + experiment.name +
                          "' error_percent must be > 0",
            experiment.error_percent_span);
    }
  }

  void check_couplings(const ModelAst& model) {
    std::unordered_map<std::string, const Node*> atomics;
    std::unordered_map<std::string, const Node*> process_stages;
    for (const Node& member : model.members) {
      if (member.kind == "atomic") {
        atomics.emplace(member.name, &member);
      }
      if (registry_ != nullptr && registry_->has_block(member.registry_key()) &&
          member.kind != "resource") {
        // Agent-centric flows: process-library blocks directly under the
        // model root are coupling endpoints in the root scope.
        process_stages.emplace(member.name, &member);
      }
      if (member.kind == "process") {
        for (const Node& stage : member.children) {
          process_stages.emplace(stage.name, &stage);
        }
      }
    }
    for (const CoupleDecl& couple : model.couplings) {
      const auto from = atomics.find(couple.from_model);
      const auto to = atomics.find(couple.to_model);
      if (from != atomics.end() && to != atomics.end()) {
        // Atomic-to-atomic: from_port must be an emitted output; to_port
        // must be an input (existing v1 semantics).
        check_atomic_coupling(*from->second, *to->second, couple);
        continue;
      }
      // Process flow coupling: both ends must be registered process stages.
      // Port/shape validation (LP5003, conditional gating) is done once by
      // check_flow_scope on the model root; here we only report unknown
      // endpoints so the diagnostics stay single-source.
      const auto from_stage = process_stages.find(couple.from_model);
      const auto to_stage = process_stages.find(couple.to_model);
      if (from_stage == process_stages.end()) {
        error("LP5002", "coupling references undeclared element '" + couple.from_model + "'",
              couple.span);
        continue;
      }
      if (to_stage == process_stages.end()) {
        error("LP5002", "coupling references undeclared element '" + couple.to_model + "'",
              couple.span);
        continue;
      }
    }
  }

  void check_atomic_coupling(const Node& from, const Node& to, const CoupleDecl& couple) {
    const Behavior* from_timeout = nullptr;
    for (const Behavior& behavior : from.behaviors) {
      if (behavior.trigger == "timeout") {
        from_timeout = &behavior;
      }
    }
    bool valid_from = false;
    if (from_timeout != nullptr) {
      for (const Effect& effect : from_timeout->effects) {
        if (effect.kind == Effect::Kind::kEmit && effect.name == couple.from_port) {
          valid_from = true;
          break;
        }
      }
    }
    const Behavior* to_input = nullptr;
    for (const Behavior& behavior : to.behaviors) {
      if (behavior.trigger == "input") {
        to_input = &behavior;
      }
    }
    const bool valid_to = to_input != nullptr && to_input->port == couple.to_port;
    if (!valid_from) {
      error("LP5003",
            "coupling port '" + couple.from_model + "." + couple.from_port +
                "' is not an emitted output port",
            couple.span);
    }
    if (!valid_to) {
      error("LP5003",
            "coupling port '" + couple.to_model + "." + couple.to_port + "' is not an input port",
            couple.span);
    }
  }

  // Process flow coupling validation against the registered block shapes:
  // the from port must be an output of the source stage, the to port an
  // input of the destination stage, and any conditional port's gating field
  // must be set to true on the owning stage.
  void check_process_coupling(const Node& from, const Node& to, const CoupleDecl& couple) {
    const BlockShape* from_shape =
        registry_ == nullptr ? nullptr : registry_->resolve(from.registry_key());
    const BlockShape* to_shape =
        registry_ == nullptr ? nullptr : registry_->resolve(to.registry_key());
    if (from_shape != nullptr) {
      const BlockPortSpec* port = from_shape->port(couple.from_port);
      if (port == nullptr || port->direction == "in") {
        error("LP5003",
              "coupling port '" + couple.from_model + "." + couple.from_port +
                  "' is not an output port of " + from.kind + " '" + from.name + "'",
              couple.span);
      } else {
        check_port_condition(from, *port, couple.from_model, couple.span);
      }
    }
    if (to_shape != nullptr) {
      const BlockPortSpec* port = to_shape->port(couple.to_port);
      if (port == nullptr || port->direction == "out") {
        error("LP5003",
              "coupling port '" + couple.to_model + "." + couple.to_port +
                  "' is not an input port of " + to.kind + " '" + to.name + "'",
              couple.span);
      } else {
        check_port_condition(to, *port, couple.to_model, couple.span);
      }
    }
  }

  void check_port_condition(const Node& stage, const BlockPortSpec& port,
                            const std::string& stage_name, const Span& span) {
    if (port.condition.empty()) {
      return;
    }
    bool enabled = false;
    const Field* field = field_of(stage, port.condition.c_str());
    if (field != nullptr) {
      Value folded;
      if (fold_value(field->value, model_scope_, folded) && folded.kind == ValueKind::kBool) {
        enabled = folded.bool_value;
      }
    }
    if (!enabled) {
      error("LP5003",
            "coupling port '" + stage_name + "." + port.name + "' requires field '" +
                port.condition + "' to be true on '" + stage.name + "'",
            span);
    }
  }

  std::vector<Diagnostic> diagnostics_;
  std::unordered_set<std::string> declared_resources_;
  std::unordered_set<std::string> entity_attribute_names_;
  ParamScope model_scope_;
  const LibraryRegistry* registry_{nullptr};
};

}  // namespace

std::vector<Diagnostic> analyze_model(const ModelAst& model, const LibraryRegistry* registry,
                                      const std::vector<std::string>* libraries) {
  return Analyzer{}.run(model, registry, libraries);
}

}  // namespace logicpilot::dsl
