// Structured kernel-side diagnostics (P0: runtime error system).
//
// Mirrors the DSL compiler's dsl::Diagnostic shape so kernel failures are
// machine-readable for the IDE and the AI loop: severity + stable code +
// message. Codes use the KR1xxx family (kernel runtime):
//   KR1001  no model loaded
//   KR1002  loaded model failed re-validation
//   KR1003  model has no executable method
//   KR1004  method runtime not registered
//   KR1005  method attach failed
//   KR1006  method initialize failed
//   KR1017  shared scheduler event budget exhausted
//
// DebugRecorder captures every dispatched event in order (the base for a
// future kernel debugger); the SimulationKernel can attach one per run.
#pragma once

#include <string>
#include <vector>

#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/time/sim_time.h"

namespace logicpilot {

enum class RuntimeSeverity { kError, kWarning, kNote };

inline const char* to_string(RuntimeSeverity severity) {
  switch (severity) {
    case RuntimeSeverity::kError: return "error";
    case RuntimeSeverity::kWarning: return "warning";
    case RuntimeSeverity::kNote: return "note";
  }
  return "error";
}

struct RuntimeDiagnostic {
  RuntimeSeverity severity{RuntimeSeverity::kError};
  std::string code;    // registry entry, e.g. "KR1001"
  std::string message;
};

// "<severity>[<code>]: <message>"
inline std::string format_runtime_diagnostic(
    const RuntimeDiagnostic& diagnostic) {
  return std::string(to_string(diagnostic.severity)) + "[" +
         diagnostic.code + "]: " + diagnostic.message;
}

// Optional per-run debug capture: every dispatched event in timestamp order
// (same data TraceRecorder hashes, kept as a readable list for tooling).
class DebugRecorder {
 public:
  // A zero limit preserves the historical unbounded capture behavior. A
  // positive limit keeps only the prefix and marks the rest as dropped.
  explicit DebugRecorder(std::size_t max_events = 0)
      : max_events_{max_events} {}

  void set_max_events(std::size_t max_events) {
    max_events_ = max_events;
    truncated_ = false;
    events_.clear();
  }

  void record(const Event& event) {
    if (max_events_ == 0 || events_.size() < max_events_) {
      events_.push_back(event);
    } else {
      truncated_ = true;
    }
  }

  [[nodiscard]] const std::vector<Event>& events() const { return events_; }
  [[nodiscard]] std::size_t event_count() const { return events_.size(); }
  [[nodiscard]] bool truncated() const { return truncated_; }
  [[nodiscard]] std::size_t max_events() const { return max_events_; }
  void clear() {
    events_.clear();
    truncated_ = false;
  }

 private:
  std::vector<Event> events_;
  std::size_t max_events_{0};
  bool truncated_{false};
};

}  // namespace logicpilot
