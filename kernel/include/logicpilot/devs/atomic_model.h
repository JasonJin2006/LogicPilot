// DEVS-lite AtomicModel.
//
// Classic DEVS atom semantics, deliberately simplified (DEVS-*lite*):
//   * ta()      - time advance; infinity() marks a passive model.
//   * delta_ext - external_transition(now, port, payload).
//   * delta_int - internal_transition(now); outputs are staged via emit()
//                 during the call and routed by the executor afterwards.
// Not modeled (deferred): elapsed-time carryover, imminent/confluent
// handling, selective rule. The executor documents these simplifications.
#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/port_event.h"

namespace logicpilot {

class AtomicModel {
 public:
  virtual ~AtomicModel() = default;

  // ta(): time until the next internal transition. SimTime::infinity() when
  // the model is passive (nothing pending).
  [[nodiscard]] virtual SimTime time_advance() const = 0;

  // delta_ext: an input arrived on `port`.
  virtual void external_transition(SimTime now, PortId port,
                                   std::uint64_t payload) = 0;

  // delta_int: the scheduled internal transition fires. Stage outputs with
  // emit(); the executor routes them after the call returns.
  virtual void internal_transition(SimTime now) = 0;

  // Output staging (executor-managed lifetime).
  [[nodiscard]] const std::vector<PortEvent>& staged_outputs() const {
    return outputs_;
  }
  void clear_outputs() { outputs_.clear(); }

  // Port naming: models declare their own ports (name -> stable local
  // PortId); the executor resolves coupling strings through this table at
  // load time, so routing never depends on global declaration order.
  PortId declare_port(const std::string& name) {
    const auto it = port_names_.find(name);
    if (it != port_names_.end()) {
      return it->second;
    }
    const auto id = static_cast<PortId>(port_names_.size());
    port_names_.emplace(name, id);
    return id;
  }
  [[nodiscard]] PortId resolve_port(const std::string& name) const {
    const auto it = port_names_.find(name);
    if (it == port_names_.end()) {
      throw std::logic_error("AtomicModel: unknown port '" + name + "'");
    }
    return it->second;
  }

 protected:
  void emit(PortId port, std::uint64_t payload = 0) {
    outputs_.push_back(PortEvent{port, payload});
  }

 private:
  std::vector<PortEvent> outputs_;
  std::unordered_map<std::string, PortId> port_names_;
};

}  // namespace logicpilot
