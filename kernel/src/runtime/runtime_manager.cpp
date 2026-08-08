// RuntimeManager implementation (see runtime_manager.h).
#include "logicpilot/runtime/runtime_manager.h"

#include <utility>

#include "logicpilot/devs/ir_loader.h"

namespace logicpilot {

bool RuntimeManager::add(std::unique_ptr<SimulationMethod> method, std::string* error) {
  if (method == nullptr) {
    if (error != nullptr) {
      *error = "null method runtime";
    }
    return false;
  }
  const std::string_view name = method->method_name();
  for (const auto& attached : methods_) {
    if (attached->method_name() == name) {
      if (error != nullptr) {
        *error = "method '" + std::string(name) + "' is already attached";
      }
      return false;
    }
  }
  methods_.push_back(std::move(method));
  return true;
}

bool RuntimeManager::initialize(const IrModelFile& model, std::string* error) {
  // One replication = one fresh world: the clock restarts, the kernel-level
  // handler registry and the shared variable store are cleared. Method
  // runtimes then register their handlers and schedule their initial events
  // into the same clock/scheduler (SimulationKernel driver).
  context_.clock().reset();
  context_.handlers().clear();
  context_.variables().clear();
  context_.messages().clear();
  for (auto& method : methods_) {
    std::string local_error;
    if (!method->initialize(context_, model, &local_error)) {
      if (error != nullptr) {
        *error = "method '" + std::string(method->method_name()) +
                 "': " + (local_error.empty() ? "initialize failed" : local_error);
      }
      // Roll back: a partially initialized method may have registered
      // handlers and scheduled events. They must not leak into a later run
      // (the kernel clears these at the start of the next initialize()).
      context_.handlers().clear();
      context_.variables().clear();
      context_.messages().clear();
      return false;
    }
  }
  return true;
}

void RuntimeManager::advance(SimTime until) {
  for (auto& method : methods_) {
    method->advance(until);
  }
}

void RuntimeManager::shutdown() {
  for (auto& method : methods_) {
    method->shutdown();
  }
}

}  // namespace logicpilot
