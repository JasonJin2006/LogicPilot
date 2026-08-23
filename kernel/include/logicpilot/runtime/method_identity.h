// Stable method-family/formalism metadata used by runtime coordination.
#pragma once

#include <string_view>

namespace logicpilot {

enum class MethodFamily {
  kUnknown,
  kDiscreteEvent,
  kAgentBased,
  kSystemDynamics,
};

enum class MethodFormalism {
  kUnknown,
  kDevs,
  kProcess,
  kStatechart,
  kAgent,
  kSd,
};

constexpr std::string_view to_string(MethodFamily family) {
  switch (family) {
    case MethodFamily::kDiscreteEvent: return "discrete_event";
    case MethodFamily::kAgentBased: return "agent";
    case MethodFamily::kSystemDynamics: return "system_dynamics";
    case MethodFamily::kUnknown: return "unknown";
  }
  return "unknown";
}

constexpr std::string_view to_string(MethodFormalism formalism) {
  switch (formalism) {
    case MethodFormalism::kDevs: return "devs";
    case MethodFormalism::kProcess: return "process";
    case MethodFormalism::kStatechart: return "statechart";
    case MethodFormalism::kAgent: return "agent";
    case MethodFormalism::kSd: return "sd";
    case MethodFormalism::kUnknown: return "unknown";
  }
  return "unknown";
}

constexpr MethodFamily parse_method_family(std::string_view value) {
  if (value == "discrete_event") return MethodFamily::kDiscreteEvent;
  if (value == "agent") return MethodFamily::kAgentBased;
  if (value == "system_dynamics") return MethodFamily::kSystemDynamics;
  return MethodFamily::kUnknown;
}

constexpr MethodFormalism parse_method_formalism(std::string_view value) {
  if (value == "devs") return MethodFormalism::kDevs;
  if (value == "process") return MethodFormalism::kProcess;
  if (value == "statechart") return MethodFormalism::kStatechart;
  if (value == "agent") return MethodFormalism::kAgent;
  if (value == "sd") return MethodFormalism::kSd;
  return MethodFormalism::kUnknown;
}

}  // namespace logicpilot
