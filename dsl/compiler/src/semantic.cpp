// Semantic analysis implementation (dsl-spec.md section 2; see semantic.h
// for the check catalogue and diagnostic codes).
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
    for (const ResourceDecl& resource : model.resources) {
      declared_resources_.insert(resource.name);
    }
    check_top_level_names(model);
    for (const ResourceDecl& resource : model.resources) {
      check_resource(resource);
    }
    for (const ProcessDecl& process : model.processes) {
      check_process(process);
    }
    for (const AtomicDecl& atomic : model.atomics) {
      check_atomic(atomic);
    }
    for (const AgentDecl& agent : model.agents) {
      check_agent(agent);
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

  // Scope resolution: model member names are one shared namespace.
  void check_top_level_names(const ModelAst& model) {
    std::unordered_map<std::string, Span> declared;
    const auto declare = [&](const std::string& name, const Span& span,
                             const char* what) {
      const auto [it, inserted] = declared.emplace(name, span);
      if (!inserted) {
        push(Severity::kError, "LP1001",
             "duplicate declaration of " + std::string(what) + " '" + name +
                 "' (previously declared at line " +
                 std::to_string(it->second.line) + ")",
             span);
      }
    };
    for (const ResourceDecl& resource : model.resources) {
      declare(resource.name, resource.name_span, "resource");
    }
    for (const ProcessDecl& process : model.processes) {
      declare(process.name, process.name_span, "process");
    }
    for (const AtomicDecl& atomic : model.atomics) {
      declare(atomic.name, atomic.name_span, "atomic");
    }
    for (const AgentDecl& agent : model.agents) {
      declare(agent.name, agent.name_span, "agent");
    }
  }

  // Kernel-built-in agent behavior handlers (v0.1 registry; the runtime
  // implements exactly these, see kernel/src/devs/ir_agent.cpp).
  bool known_handler(const std::string& handler) const {
    return handler == "noop" || handler == "flip" || handler == "bounce";
  }

  void check_agent(const AgentDecl& agent) {
    if (agent.count_count == 0) {
      push(Severity::kError, "LP2001",
           "missing required field 'count' in agent '" + agent.name + "'",
           agent.span);
    } else {
      if (agent.count_count > 1) {
        push(Severity::kError, "LP1002",
             "duplicate field 'count' in agent '" + agent.name + "'",
             agent.count_field_span);
      }
      if (agent.has_count && agent.count < 1) {
        push(Severity::kError, "LP3001",
             "agent '" + agent.name + "' count must be >= 1 (got " +
                 std::to_string(agent.count) + ")",
             agent.count_field_span);
      }
    }
    std::unordered_map<std::string, Span> state_names;
    for (const StateVarDecl& var : agent.state) {
      const auto [it, inserted] = state_names.emplace(var.name,
                                                      var.name_span);
      if (!inserted) {
        push(Severity::kError, "LP1002",
             "duplicate state variable '" + var.name + "' in agent '" +
                 agent.name + "'",
             var.name_span);
      }
    }
    for (const TickBehavior& behavior : agent.behaviors) {
      if (!known_handler(behavior.handler)) {
        push(Severity::kError, "LP6001",
             "unknown agent behavior handler '" + behavior.handler +
                 "' in agent '" + agent.name +
                 "' (v0.1 registry: noop, flip <state>, bounce)",
             behavior.handler_span);
        continue;
      }
      if (behavior.handler == "flip") {
        if (!behavior.has_arg) {
          push(Severity::kError, "LP6002",
               "'flip' in agent '" + agent.name +
                   "' requires a state-variable argument",
               behavior.span);
        } else {
          bool declared_bool = false;
          for (const StateVarDecl& var : agent.state) {
            if (var.name == behavior.arg &&
                var.value.kind == AtomicValueKind::kBool) {
              declared_bool = true;
              break;
            }
          }
          if (!declared_bool) {
            push(Severity::kError, "LP6002",
                 "'flip' argument '" + behavior.arg + "' in agent '" +
                     agent.name + "' is not a declared bool state variable",
                 behavior.arg_span);
          }
        }
      } else if (behavior.has_arg) {
        push(Severity::kError, "LP6002",
             "behavior '" + behavior.handler + "' in agent '" + agent.name +
                 "' takes no argument",
             behavior.arg_span);
      }
    }
  }

  bool known_metric(const std::string& metric) const {
    return metric == "throughput" || metric == "Wq" || metric == "W" ||
           metric == "Lq";
  }

  void check_experiment(const ExperimentDecl& experiment) {
    const auto duplicate = [&](int count, const char* field,
                               const Span& span) {
      if (count > 1) {
        push(Severity::kError, "LP1002",
             "duplicate field '" + std::string(field) + "' in experiment '" +
                 experiment.name + "'",
             span);
      }
    };
    duplicate(experiment.objective_count, "objective", experiment.objective_span);
    duplicate(experiment.metric_count, "metric", experiment.metric_span);
    duplicate(experiment.variable_count, "variable", experiment.variable_span);
    duplicate(experiment.range_count, "range", experiment.range_span);
    duplicate(experiment.budget_count, "budget", experiment.budget_span);

    const auto required = [&](bool has, const char* field) {
      if (!has) {
        push(Severity::kError, "LP2001",
             "missing required field '" + std::string(field) +
                 "' in experiment '" + experiment.name + "'",
             experiment.span);
      }
    };
    required(experiment.has_objective, "objective");
    required(experiment.has_metric, "metric");
    required(experiment.has_variable, "variable");
    required(experiment.has_range, "range");

    if (experiment.has_objective &&
        experiment.objective != "maximize" &&
        experiment.objective != "minimize") {
      push(Severity::kError, "LP7001",
           "experiment '" + experiment.name + "' objective must be " +
               "'maximize' or 'minimize' (got '" + experiment.objective + "')",
           experiment.objective_span);
    }
    if (experiment.has_metric && !known_metric(experiment.metric)) {
      push(Severity::kError, "LP7001",
           "experiment '" + experiment.name + "' metric must be one of " +
               "throughput/Wq/W/Lq (got '" + experiment.metric + "')",
           experiment.metric_span);
    }
    if (experiment.has_variable && experiment.variable != "servers") {
      push(Severity::kError, "LP7001",
           "experiment '" + experiment.name +
               "' v0.1 optimizable variable is 'servers' (got '" +
               experiment.variable + "')",
           experiment.variable_span);
    }
    if (experiment.has_range &&
        (experiment.range_min < 1 || experiment.range_max < experiment.range_min)) {
      push(Severity::kError, "LP3001",
           "experiment '" + experiment.name + "' range must satisfy " +
               "1 <= min <= max (got " +
               std::to_string(experiment.range_min) + ".." +
               std::to_string(experiment.range_max) + ")",
           experiment.range_span);
    }
    if (experiment.has_budget && experiment.budget < 1) {
      push(Severity::kError, "LP3001",
           "experiment '" + experiment.name + "' budget must be >= 1",
           experiment.budget_span);
    }
  }

  void check_atomic(const AtomicDecl& atomic) {
    std::unordered_map<std::string, Span> state_names;
    for (const StateVarDecl& var : atomic.state) {
      const auto [it, inserted] = state_names.emplace(var.name,
                                                      var.name_span);
      if (!inserted) {
        push(Severity::kError, "LP1002",
             "duplicate state variable '" + var.name + "' in atomic '" +
                 atomic.name + "'",
             var.name_span);
      }
    }
    if (atomic.ta.count > 1) {
      push(Severity::kError, "LP1002",
           "duplicate field 'time_advance' in atomic '" + atomic.name + "'",
           atomic.ta.span);
    }
    if (atomic.ta.has) {
      if (atomic.ta.kind == TaKind::kConstant && atomic.ta.value < 0.0) {
        push(Severity::kError, "LP3001",
             "atomic '" + atomic.name + "' time_advance must be >= 0 (got " +
                 std::to_string(atomic.ta.value) + ")",
             atomic.ta.span);
      }
      if (atomic.ta.kind == TaKind::kExponential &&
          !(atomic.ta.value > 0.0)) {
        push(Severity::kError, "LP3001",
             "atomic '" + atomic.name +
                 "' time_advance exponential rate must be > 0",
             atomic.ta.span);
      }
    }
    // v1 IR (F1) constraint: a single external transition (one input port)
    // and a single internal transition.
    if (atomic.on_input.size() > 1) {
      push(Severity::kError, "LP2003",
           "atomic '" + atomic.name +
               "' supports at most one on_input transition in v1 (F1 IR "
               "constraint)",
           atomic.on_input[1].span);
    }
    for (const TransitionDecl& transition : atomic.on_input) {
      check_effects(atomic, transition.effects);
    }
    if (atomic.on_timeout.count > 1) {
      push(Severity::kError, "LP1002",
           "duplicate 'on_timeout' in atomic '" + atomic.name + "'",
           atomic.on_timeout.span);
    }
    check_effects(atomic, atomic.on_timeout.effects);
  }

  void check_effects(const AtomicDecl& atomic,
                     const std::vector<Effect>& effects) {
    for (const Effect& effect : effects) {
      bool declared = false;
      for (const StateVarDecl& var : atomic.state) {
        if (var.name == effect.name) {
          declared = true;
          break;
        }
      }
      if (!declared) {
        push(Severity::kError, "LP5001",
             "effect references undeclared state variable '" + effect.name +
                 "' in atomic '" + atomic.name + "'",
             effect.name_span);
      }
    }
  }

  void check_couplings(const ModelAst& model) {
    std::unordered_map<std::string, const AtomicDecl*> atomics;
    for (const AtomicDecl& atomic : model.atomics) {
      atomics.emplace(atomic.name, &atomic);
    }
    for (const CoupleDecl& couple : model.couplings) {
      const auto from = atomics.find(couple.from_model);
      const auto to = atomics.find(couple.to_model);
      if (from == atomics.end()) {
        push(Severity::kError, "LP5002",
             "coupling references undeclared atomic model '" +
                 couple.from_model + "'",
             couple.span);
        continue;
      }
      if (to == atomics.end()) {
        push(Severity::kError, "LP5002",
             "coupling references undeclared atomic model '" +
                 couple.to_model + "'",
             couple.span);
        continue;
      }
      // from_port must be an emitted output; to_port must be an input.
      const bool valid_from =
          from->second->on_timeout.has && from->second->on_timeout.emit &&
          from->second->on_timeout.emit_port == couple.from_port;
      const bool valid_to =
          !to->second->on_input.empty() &&
          to->second->on_input.front().port == couple.to_port;
      if (!valid_from) {
        push(Severity::kError, "LP5003",
             "coupling port '" + couple.from_model + "." +
                 couple.from_port + "' is not an emitted output port",
             couple.span);
      }
      if (!valid_to) {
        push(Severity::kError, "LP5003",
             "coupling port '" + couple.to_model + "." + couple.to_port +
                 "' is not an input port",
             couple.span);
      }
    }
  }

  void check_resource(const ResourceDecl& resource) {
    if (resource.capacity_count == 0) {
      push(Severity::kError, "LP2001",
           "missing required field 'capacity' in resource '" +
               resource.name + "'",
           resource.span);
    } else {
      if (resource.capacity_count > 1) {
        push(Severity::kError, "LP1002",
             "duplicate field 'capacity' in resource '" + resource.name + "'",
             resource.capacity_field_span);
      }
      if (resource.has_capacity && resource.capacity < 1) {
        push(Severity::kError, "LP3001",
             "resource '" + resource.name + "' capacity must be >= 1 (got " +
                 std::to_string(resource.capacity) + ")",
             resource.capacity_field_span);
      }
    }
    if (resource.failure_rate_count > 1) {
      push(Severity::kError, "LP1002",
           "duplicate field 'failure_rate' in resource '" + resource.name +
               "'",
           resource.failure_rate_field_span);
    }
    if (resource.has_failure_rate &&
        (resource.failure_rate < 0.0 || resource.failure_rate > 1.0)) {
      push(Severity::kError, "LP3001",
           "resource '" + resource.name +
               "' failure_rate must be in [0, 1] (got " +
               std::to_string(resource.failure_rate) + ")",
           resource.failure_rate_field_span);
    }
  }

  // Resource reference resolution (services consume declared resources).
  bool resource_declared(const std::string& name) const {
    return declared_resources_.count(name) > 0;
  }

  void check_distribution(const Distribution& dist,
                          const std::string& context) {
    for (const double param : dist.params) {
      if (!(param > 0.0)) {
        push(Severity::kError, "LP3001",
             context + ": distribution parameter must be > 0 (got " +
                 std::to_string(param) + ")",
             dist.span);
        return;  // one diagnostic per distribution
      }
    }
  }

  void check_stage_names(const ProcessDecl& process) {
    std::unordered_map<std::string, Span> declared;
    for (const StageDecl& stage : process.stages) {
      const auto [it, inserted] = declared.emplace(stage.name,
                                                   stage.name_span);
      if (!inserted) {
        push(Severity::kError, "LP1001",
             "duplicate stage '" + stage.name + "' in process '" +
                 process.name + "' (previously declared at line " +
                 std::to_string(it->second.line) + ")",
             stage.name_span);
      }
    }
  }

  void check_process(const ProcessDecl& process) {
    check_stage_names(process);

    int sources = 0;
    int queues = 0;
    int services = 0;
    for (const StageDecl& stage : process.stages) {
      switch (stage.kind) {
        case StageDecl::Kind::kSource:
          ++sources;
          if (stage.arrival_count == 0) {
            push(Severity::kError, "LP2001",
                 "missing required field 'arrival' in source '" + stage.name +
                     "'",
                 stage.span);
          } else {
            if (stage.arrival_count > 1) {
              push(Severity::kError, "LP1002",
                   "duplicate field 'arrival' in source '" + stage.name + "'",
                   stage.arrival_field_span);
            }
            if (stage.has_arrival) {
              check_distribution(stage.arrival,
                                 "source '" + stage.name + "' arrival");
            }
          }
          break;
        case StageDecl::Kind::kQueue:
          ++queues;
          if (stage.capacity_count == 0) {
            push(Severity::kError, "LP2001",
                 "missing required field 'capacity' in queue '" + stage.name +
                     "'",
                 stage.span);
          } else {
            if (stage.capacity_count > 1) {
              push(Severity::kError, "LP1002",
                   "duplicate field 'capacity' in queue '" + stage.name + "'",
                   stage.capacity_field_span);
            }
            if (stage.has_capacity && stage.capacity < 0) {
              push(Severity::kError, "LP3001",
                   "queue '" + stage.name +
                       "' capacity must be >= 0 (got " +
                       std::to_string(stage.capacity) + ")",
                   stage.capacity_field_span);
            }
          }
          break;
        case StageDecl::Kind::kService: {
          ++services;
          if (stage.time_count == 0) {
            push(Severity::kError, "LP2001",
                 "missing required field 'time' in service '" + stage.name +
                     "'",
                 stage.span);
          } else {
            if (stage.time_count > 1) {
              push(Severity::kError, "LP1002",
                   "duplicate field 'time' in service '" + stage.name + "'",
                   stage.time_field_span);
            }
            if (stage.has_time) {
              check_distribution(stage.service_time,
                                 "service '" + stage.name + "' time");
            }
          }
          if (!resource_declared(stage.name)) {
            push(Severity::kError, "LP4001",
                 "service '" + stage.name +
                     "' references undeclared resource '" + stage.name + "'",
                 stage.name_span);
          }
          break;
        }
      }
    }

    if (sources == 0) {
      push(Severity::kError, "LP2002",
           "process '" + process.name + "' has no source stage",
           process.span);
    } else if (sources > 1) {
      push(Severity::kError, "LP2003",
           "process '" + process.name +
               "' declares more than one source (v0 supports one)",
           process.span);
    }
    if (queues > 1) {
      push(Severity::kError, "LP2003",
           "process '" + process.name +
               "' declares more than one queue (v0 supports one)",
           process.span);
    }
    if (services == 0) {
      push(Severity::kError, "LP2002",
           "process '" + process.name + "' has no service stage",
           process.span);
    } else if (services > 1) {
      push(Severity::kError, "LP2003",
           "process '" + process.name +
               "' declares more than one service (v0 supports one)",
           process.span);
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
