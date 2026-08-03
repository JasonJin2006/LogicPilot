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
