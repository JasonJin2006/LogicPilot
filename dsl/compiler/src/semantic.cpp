// Semantic analysis implementation (dsl-v2 generic, docs/specs/dsl-v2.md;
// see semantic.h for the check catalogue and diagnostic codes).
//
// Kind resolution drives everything: `kind` is resolved against the core
// kinds (agent/atomic/process/continuous/experiment) and the builtin
// process library registry (resource/source/queue/service/sink); block
// instances are then validated against their registered shape (required
// fields, duplicates, ranges, references).
#include "logicpilot/dsl/semantic.h"

#include <algorithm>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace logicpilot::dsl {
namespace {

class Analyzer {
 public:
  std::vector<Diagnostic> run(const ModelAst& model) {
    declared_resources_.clear();
    for (const Node& member : model.members) {
      if (member.kind == "resource") {
        declared_resources_.insert(member.name);
      }
    }
    check_model_params(model);
    for (const std::string& library : model.used_libraries) {
      check_library(library, model);
    }
    check_top_level_names(model);
    for (const Node& member : model.members) {
      check_decl(member, true);
    }
    for (const ExperimentDecl& experiment : model.experiments) {
      check_experiment(experiment);
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
  void push(Severity severity, const char* code, const std::string& message,
            const Span& span) {
    Diagnostic diagnostic;
    diagnostic.severity = severity;
    diagnostic.code = code;
    diagnostic.message = message;
    diagnostic.span = span;
    diagnostics_.push_back(std::move(diagnostic));
  }

  void error(const char* code, const std::string& message,
             const Span& span) {
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
      const auto [it, inserted] =
          declared.emplace(param.name, param.name_span);
      if (!inserted) {
        error("LP1001",
              "duplicate declaration of param '" + param.name +
                  "' (previously declared at line " +
                  std::to_string(it->second.line) + ")",
              param.name_span);
      }
    }
  }

  // `use` is validated once multiple libraries land (Phase E); for now the
  // standard process library is implicitly available, so any identifier is
  // accepted and unused-library diagnostics are deferred.
  void check_library(const std::string& library, const ModelAst& model) {
    (void)model;
    if (library != "process") {
      error("LP2004",
            "unknown library '" + library +
                "' (only 'process' is registered in v2 stage 1)",
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
      const auto [it, inserted] =
          declared.emplace(member.name, member.name_span);
      if (!inserted) {
        error("LP1001",
              "duplicate declaration of " + member.kind + " '" +
                  member.name + "' (previously declared at line " +
                  std::to_string(it->second.line) + ")",
              member.name_span);
      }
    }
  }

  // ------------------------------------------------------------------
  // Generic declaration dispatch (kind resolution)
  // ------------------------------------------------------------------

  void check_decl(const Node& node, bool top_level) {
    const std::string& kind = node.kind;
    if (kind == "process") {
      if (!top_level) {
        error("LP2004",
              "process '" + node.name + "' must be declared at model level",
              node.span);
        return;
      }
      check_process(node);
      return;
    }
    if (kind == "atomic") {
      check_atomic(node);
      return;
    }
    if (kind == "agent") {
      check_agent(node);
      return;
    }
    if (kind == "continuous") {
      check_continuous(node);
      return;
    }
    if (kind == "resource") {
      check_resource(node);
      return;
    }
    if (kind == "experiment") {
      return;  // validated via the typed ExperimentDecl list below
    }
    if (kind == "source" || kind == "queue" || kind == "service" ||
        kind == "sink") {
      if (!top_level) {
        // Process stages are validated by check_process.
        return;
      }
      error("LP2004",
            "process block '" + kind + "' must be declared inside a process",
            node.span);
      return;
    }
    error("LP2004",
          "unknown declaration kind '" + kind + "' (core kinds: "
              "agent/atomic/process/continuous/experiment; process library: "
              "resource/source/queue/service/sink)",
          node.name_span);
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
  void check_shape(const Node& node,
                   const std::unordered_set<std::string>& allowed_fields,
                   const std::unordered_set<std::string>& allowed_vars) {
    for (const Field& field : node.fields) {
      if (!allowed_fields.count(field.name)) {
        error("LP2005",
              "unknown field '" + field.name + "' in " + node.kind + " '" +
                  node.name + "'",
              field.name_span);
      }
    }
    for (const VarDecl& var : node.vars) {
      if (!allowed_vars.count(var.keyword)) {
        error("LP2005",
              "'" + var.keyword + "' is not allowed in " + node.kind + " '" +
                  node.name + "'",
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
            "duplicate field '" + std::string(field_name) + "' in " +
                node.kind + " '" + node.name + "'",
            last ? last->span : node.span);
    }
  }

  void check_missing(const Node& node, const char* field_name,
                     const Field* field) {
    if (field == nullptr) {
      error("LP2001",
            "missing required field '" + std::string(field_name) + "' in " +
                node.kind + " '" + node.name + "'",
            node.span);
    }
  }

  void check_distribution(const Distribution& dist,
                          const std::string& context) {
    for (const double param : dist.params) {
      if (!(param > 0.0)) {
        error("LP3001",
              context + ": distribution parameter must be > 0 (got " +
                  std::to_string(param) + ")",
              dist.span);
        return;  // one diagnostic per distribution
      }
    }
  }

  // ------------------------------------------------------------------
  // Process library blocks
  // ------------------------------------------------------------------

  void check_resource(const Node& node) {
    check_shape(node, {"capacity", "failure_rate"}, {});
    const Field* capacity = field_of(node, "capacity");
    check_missing(node, "capacity", capacity);
    check_duplicate(node, "capacity");
    if (capacity) {
      if (capacity->value.kind == ValueKind::kInt &&
          capacity->value.int_value < 1) {
        error("LP3001",
              "resource '" + node.name + "' capacity must be >= 1 (got " +
                  std::to_string(capacity->value.int_value) + ")",
              capacity->span);
      }
    }
    const Field* failure_rate = field_of(node, "failure_rate");
    check_duplicate(node, "failure_rate");
    if (failure_rate) {
      if (failure_rate->value.kind == ValueKind::kFloat &&
          (failure_rate->value.float_value < 0.0 ||
           failure_rate->value.float_value > 1.0)) {
        error("LP3001",
              "resource '" + node.name +
                  "' failure_rate must be in [0, 1] (got " +
                  std::to_string(failure_rate->value.float_value) + ")",
              failure_rate->span);
      }
    }
  }

  void check_stage(const Node& node) {
    if (node.kind == "source") {
      check_shape(node, {"arrival"}, {});
      const Field* arrival = field_of(node, "arrival");
      check_missing(node, "arrival", arrival);
      check_duplicate(node, "arrival");
      if (arrival) {
        Distribution dist;
        if (!distribution_from_value(arrival->value, dist)) {
          error("LP3001",
                "source '" + node.name +
                    "' arrival: expected poisson/rate/exponential/normal/"
                    "constant(...)",
                arrival->span);
        } else {
          check_distribution(dist, "source '" + node.name + "' arrival");
        }
      }
      return;
    }
    if (node.kind == "queue") {
      check_shape(node, {"capacity"}, {});
      const Field* capacity = field_of(node, "capacity");
      check_missing(node, "capacity", capacity);
      check_duplicate(node, "capacity");
      if (capacity && capacity->value.kind == ValueKind::kInt &&
          capacity->value.int_value < 0) {
        error("LP3001",
              "queue '" + node.name + "' capacity must be >= 0 (got " +
                  std::to_string(capacity->value.int_value) + ")",
              capacity->span);
      }
      return;
    }
    if (node.kind == "service") {
      check_shape(node, {"time"}, {});
      const Field* time = field_of(node, "time");
      check_missing(node, "time", time);
      check_duplicate(node, "time");
      if (time) {
        Distribution dist;
        if (!distribution_from_value(time->value, dist)) {
          error("LP3001",
                "service '" + node.name +
                    "' time: expected poisson/rate/exponential/normal/"
                    "constant(...)",
                time->span);
        } else {
          check_distribution(dist, "service '" + node.name + "' time");
        }
      }
      // v0 binding: the service identifier names the resource it consumes
      // (explicit `resource = R` references land in Phase C).
      if (!resource_declared(node.name)) {
        error("LP4001",
              "service '" + node.name +
                  "' references undeclared resource '" + node.name + "'",
              node.name_span);
      }
      return;
    }
    if (node.kind == "sink") {
      check_shape(node, {}, {});
      return;
    }
    error("LP2004",
          "block '" + node.kind + "' is not a process stage "
              "(source/queue/service/sink)",
          node.name_span);
  }

  void check_process(const Node& node) {
    std::unordered_map<std::string, Span> stage_names;
    int sources = 0;
    int queues = 0;
    int services = 0;
    for (const Node& stage : node.children) {
      const auto [it, inserted] =
          stage_names.emplace(stage.name, stage.name_span);
      if (!inserted) {
        error("LP1001",
              "duplicate stage '" + stage.name + "' in process '" +
                  node.name + "' (previously declared at line " +
                  std::to_string(it->second.line) + ")",
              stage.name_span);
      }
      if (stage.kind == "source") {
        ++sources;
      } else if (stage.kind == "queue") {
        ++queues;
      } else if (stage.kind == "service") {
        ++services;
      }
      check_stage(stage);
    }
    if (sources == 0) {
      error("LP2002",
            "process '" + node.name + "' has no source stage", node.span);
    } else if (sources > 1) {
      error("LP2003",
            "process '" + node.name +
                "' declares more than one source (v0 supports one)",
            node.span);
    }
    if (queues > 1) {
      error("LP2003",
            "process '" + node.name +
                "' declares more than one queue (v0 supports one)",
            node.span);
    }
    if (services == 0) {
      error("LP2002",
            "process '" + node.name + "' has no service stage", node.span);
    } else if (services > 1) {
      error("LP2003",
            "process '" + node.name +
                "' declares more than one service (v0 supports one)",
            node.span);
    }
  }

  bool resource_declared(const std::string& name) const {
    return declared_resources_.count(name) > 0;
  }

  // ------------------------------------------------------------------
  // atomic / agent / continuous
  // ------------------------------------------------------------------

  void check_effects(const Node& node,
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
              "effect references undeclared state variable '" +
                  effect.name + "' in atomic '" + node.name + "'",
              effect.name_span);
      }
    }
  }

  void check_atomic(const Node& node) {
    check_shape(node, {"time_advance"}, {"state"});
    std::unordered_map<std::string, Span> state_names;
    for (const VarDecl& var : node.vars) {
      const auto [it, inserted] =
          state_names.emplace(var.name, var.name_span);
      if (!inserted) {
        error("LP1002",
              "duplicate state variable '" + var.name + "' in atomic '" +
                  node.name + "'",
              var.name_span);
      }
    }
    const Field* ta = field_of(node, "time_advance");
    check_duplicate(node, "time_advance");
    if (ta) {
      const Value& value = ta->value;
      bool exponential = value.kind == ValueKind::kCall &&
                         value.call_name == "exponential";
      double number = 0.0;
      bool number_value = value.kind == ValueKind::kInt ||
                          value.kind == ValueKind::kFloat;
      if (number_value) {
        number = value.kind == ValueKind::kInt
                     ? static_cast<double>(value.int_value)
                     : value.float_value;
      }
      if (exponential) {
        if (value.call_args.size() != 1 || !(value.call_args[0] > 0.0)) {
          error("LP3001",
                "atomic '" + node.name +
                    "' time_advance exponential rate must be > 0",
                ta->span);
        }
      } else if (number_value && number < 0.0) {
        error("LP3001",
              "atomic '" + node.name + "' time_advance must be >= 0 (got " +
                  std::to_string(number) + ")",
              ta->span);
      } else if (value.kind == ValueKind::kCall &&
                 value.call_name != "constant") {
        error("LP3001",
              "atomic '" + node.name +
                  "' time_advance must be a number, constant(...), "
                  "exponential(...) or infinite",
              ta->span);
      }
    }
    std::vector<const Behavior*> on_input;
    const Behavior* on_timeout = nullptr;
    for (const Behavior& behavior : node.behaviors) {
      if (behavior.trigger == "input") {
        on_input.push_back(&behavior);
      } else if (behavior.trigger == "timeout") {
        if (on_timeout != nullptr) {
          error("LP1002",
                "duplicate 'on_timeout' in atomic '" + node.name + "'",
                behavior.span);
        }
        on_timeout = &behavior;
      } else {
        error("LP2004",
              "unknown behavior trigger 'on_" + behavior.trigger +
                  "' in atomic '" + node.name +
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
      check_effects(node, behavior->effects);
    }
    if (on_timeout != nullptr) {
      check_effects(node, on_timeout->effects);
    }
  }

  // Kernel-built-in agent behavior handlers (v0.1 registry; the runtime
  // implements exactly these, see kernel/src/devs/ir_agent.cpp).
  bool known_handler(const std::string& handler) const {
    return handler == "noop" || handler == "flip" || handler == "bounce";
  }

  void check_agent(const Node& node) {
    check_shape(node, {"count"}, {"state"});
    const Field* count = field_of(node, "count");
    check_missing(node, "count", count);
    check_duplicate(node, "count");
    if (count && count->value.kind == ValueKind::kInt &&
        count->value.int_value < 1) {
      error("LP3001",
            "agent '" + node.name + "' count must be >= 1 (got " +
                std::to_string(count->value.int_value) + ")",
            count->span);
    }
    std::unordered_map<std::string, Span> state_names;
    for (const VarDecl& var : node.vars) {
      const auto [it, inserted] =
          state_names.emplace(var.name, var.name_span);
      if (!inserted) {
        error("LP1002",
              "duplicate state variable '" + var.name + "' in agent '" +
                  node.name + "'",
              var.name_span);
      }
    }
    for (const Behavior& behavior : node.behaviors) {
      if (behavior.trigger != "tick") {
        error("LP6001",
              "unknown agent behavior trigger 'on_" + behavior.trigger +
                  "' in agent '" + node.name + "' (v0.1 registry: on_tick)",
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
                "unknown agent behavior handler '" + effect.name +
                    "' in agent '" + node.name +
                    "' (v0.1 registry: noop, flip <state>, bounce)",
                effect.name_span);
          continue;
        }
        if (effect.name == "flip") {
          if (effect.arg.empty()) {
            error("LP6002",
                  "'flip' in agent '" + node.name +
                      "' requires a state-variable argument",
                  effect.name_span);
          } else {
            bool declared_bool = false;
            for (const VarDecl& var : node.vars) {
              if (var.name == effect.arg &&
                  var.value.kind == ValueKind::kBool) {
                declared_bool = true;
                break;
              }
            }
            if (!declared_bool) {
              error("LP6002",
                    "'flip' argument '" + effect.arg + "' in agent '" +
                        node.name + "' is not a declared bool state variable",
                    effect.arg_span);
            }
          }
        } else if (!effect.arg.empty()) {
          error("LP6002",
                "behavior '" + effect.name + "' in agent '" + node.name +
                    "' takes no argument",
                effect.arg_span);
        }
      }
    }
  }

  void check_continuous(const Node& node) {
    check_shape(node, {}, {"state", "param"});
    std::unordered_map<std::string, Span> names;
    const auto reserved = [&](const std::string& name, const Span& span) {
      if (name == "t") {
        error("LP8002",
              "'t' is reserved for simulation time in continuous '" +
                  node.name + "'",
              span);
      }
    };
    for (const VarDecl& var : node.vars) {
      reserved(var.name, var.name_span);
      const auto [it, inserted] = names.emplace(var.name, var.name_span);
      if (!inserted) {
        error("LP1002",
              "duplicate variable '" + var.name + "' in continuous '" +
                  node.name + "'",
              var.name_span);
      }
    }
    if (node.equations.empty()) {
      error("LP2001",
            "continuous '" + node.name +
                "' requires at least one equation (d <var>/dt = ...)",
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
              "equation lhs '" + equation.var + "' in continuous '" +
                  node.name + "' must reference a declared state variable",
              equation.span);
      }
    }
  }

  // ------------------------------------------------------------------
  // experiment / couplings
  // ------------------------------------------------------------------

  bool known_metric(const std::string& metric) const {
    return metric == "throughput" || metric == "Wq" || metric == "W" ||
           metric == "Lq";
  }

  void check_experiment(const ExperimentDecl& experiment) {
    const auto duplicate = [&](int count, const char* field_name,
                               const Span& span) {
      if (count > 1) {
        error("LP1002",
              "duplicate field '" + std::string(field_name) +
                  "' in experiment '" + experiment.name + "'",
              span);
      }
    };
    duplicate(experiment.objective_count, "objective",
              experiment.objective_span);
    duplicate(experiment.metric_count, "metric", experiment.metric_span);
    duplicate(experiment.variable_count, "variable",
              experiment.variable_span);
    duplicate(experiment.range_count, "range", experiment.range_span);
    duplicate(experiment.budget_count, "budget", experiment.budget_span);

    const auto required = [&](bool has, const char* field_name) {
      if (!has) {
        error("LP2001",
              "missing required field '" + std::string(field_name) +
                  "' in experiment '" + experiment.name + "'",
              experiment.span);
      }
    };
    required(experiment.has_objective, "objective");
    required(experiment.has_metric, "metric");
    required(experiment.has_variable, "variable");
    required(experiment.has_range, "range");

    if (experiment.has_objective && experiment.objective != "maximize" &&
        experiment.objective != "minimize") {
      error("LP7001",
            "experiment '" + experiment.name + "' objective must be "
                "'maximize' or 'minimize' (got '" +
                experiment.objective + "')",
            experiment.objective_span);
    }
    if (experiment.has_metric && !known_metric(experiment.metric)) {
      error("LP7001",
            "experiment '" + experiment.name + "' metric must be one of "
                "throughput/Wq/W/Lq (got '" +
                experiment.metric + "')",
            experiment.metric_span);
    }
    if (experiment.has_variable && experiment.variable != "servers") {
      error("LP7001",
            "experiment '" + experiment.name +
                "' v0.1 optimizable variable is 'servers' (got '" +
                experiment.variable + "')",
            experiment.variable_span);
    }
    if (experiment.has_range &&
        (experiment.range_min < 1 ||
         experiment.range_max < experiment.range_min)) {
      error("LP3001",
            "experiment '" + experiment.name + "' range must satisfy "
                "1 <= min <= max (got " +
                std::to_string(experiment.range_min) + ".." +
                std::to_string(experiment.range_max) + ")",
            experiment.range_span);
    }
    if (experiment.has_budget && experiment.budget < 1) {
      error("LP3001",
            "experiment '" + experiment.name + "' budget must be >= 1",
            experiment.budget_span);
    }
  }

  void check_couplings(const ModelAst& model) {
    std::unordered_map<std::string, const Node*> atomics;
    for (const Node& member : model.members) {
      if (member.kind == "atomic") {
        atomics.emplace(member.name, &member);
      }
    }
    for (const CoupleDecl& couple : model.couplings) {
      const auto from = atomics.find(couple.from_model);
      const auto to = atomics.find(couple.to_model);
      if (from == atomics.end()) {
        error("LP5002",
              "coupling references undeclared atomic model '" +
                  couple.from_model + "'",
              couple.span);
        continue;
      }
      if (to == atomics.end()) {
        error("LP5002",
              "coupling references undeclared atomic model '" +
                  couple.to_model + "'",
              couple.span);
        continue;
      }
      // from_port must be an emitted output; to_port must be an input.
      const Behavior* from_timeout = nullptr;
      for (const Behavior& behavior : from->second->behaviors) {
        if (behavior.trigger == "timeout") {
          from_timeout = &behavior;
        }
      }
      bool valid_from = false;
      if (from_timeout != nullptr) {
        for (const Effect& effect : from_timeout->effects) {
          if (effect.kind == Effect::Kind::kEmit &&
              effect.name == couple.from_port) {
            valid_from = true;
            break;
          }
        }
      }
      const Behavior* to_input = nullptr;
      for (const Behavior& behavior : to->second->behaviors) {
        if (behavior.trigger == "input") {
          to_input = &behavior;
        }
      }
      const bool valid_to =
          to_input != nullptr && to_input->port == couple.to_port;
      if (!valid_from) {
        error("LP5003",
              "coupling port '" + couple.from_model + "." +
                  couple.from_port + "' is not an emitted output port",
              couple.span);
      }
      if (!valid_to) {
        error("LP5003",
              "coupling port '" + couple.to_model + "." + couple.to_port +
                  "' is not an input port",
              couple.span);
      }
    }
  }

  std::vector<Diagnostic> diagnostics_;
  std::unordered_set<std::string> declared_resources_;
};

}  // namespace

std::vector<Diagnostic> analyze_model(const ModelAst& model) {
  return Analyzer{}.run(model);
}

}  // namespace logicpilot::dsl
