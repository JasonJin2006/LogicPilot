// DevsExecutor - drives a DEVS-lite coupling tree on the kernel scheduler.
//
// load() flattens the (possibly nested) CoupledModel into atomic-level
// routing: every child output port maps to the set of target atom input
// ports, with parent-port pass-through ("." couplings) resolved through all
// nesting levels. run() then executes the classic next-event loop on an
// IEventScheduler:
//   * each atom holds at most one pending internal event at now + ta();
//   * an internal transition fires, its staged outputs are routed
//     synchronously to targets (external transitions preempt the target's
//     pending internal and reschedule it at now + ta()), and the atom is
//     rescheduled;
//   * inject() feeds the root's input ports from the outside.
// DEVS-lite simplifications (documented, deliberate): no elapsed-time
// carryover, no confluent/imminent tie resolution (equal-time internal
// events follow scheduler FIFO order), single output phase per internal
// transition.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/core/scheduler/event.h"
#include "logicpilot/core/scheduler/handler_registry.h"
#include "logicpilot/core/scheduler/i_event_scheduler.h"
#include "logicpilot/core/scheduler/run.h"
#include "logicpilot/core/time/clock.h"
#include "logicpilot/core/time/sim_time.h"
#include "logicpilot/devs/coupled_model.h"
#include "logicpilot/devs/port_event.h"

namespace logicpilot {

class DevsExecutor {
 public:
  explicit DevsExecutor(IEventScheduler& scheduler, SimulationClock& clock);

  DevsExecutor(const DevsExecutor&) = delete;
  DevsExecutor& operator=(const DevsExecutor&) = delete;

  // Flatten `root` and schedule every active atom's first internal event.
  // Returns the number of atomic models loaded. Throws std::logic_error on
  // malformed coupling specs (unknown child/port).
  std::size_t load(CoupledModel& root);

  // Deliver an external input on a root-level input port at the current
  // clock time. Unknown ports are ignored (returns false).
  bool inject(const std::string& root_port, std::uint64_t payload = 0);

  // Run the next-event loop until the queue drains or `horizon` is reached.
  // Returns the number of events dispatched.
  std::size_t run(SimTime horizon);

  [[nodiscard]] std::size_t atom_count() const { return atoms_.size(); }
  [[nodiscard]] std::size_t dispatched_total() const { return dispatched_; }
  // Internal-transition budget for the next run(): after `budget` internal
  // firings the executor stops re-arming atoms, so perpetual emitters
  // terminate deterministically (0 = unlimited, the default).
  void set_internal_budget(std::size_t budget) { internal_budget_ = budget; }
  [[nodiscard]] std::size_t internal_transitions() const {
    return internal_transitions_;
  }
  [[nodiscard]] SimulationClock& clock() { return clock_; }

 private:
  struct RouteTarget {
    std::uint32_t atom;
    PortId port;
  };
  struct ExtInput {
    std::uint32_t atom;
    PortEvent event;
  };

  static std::uint64_t route_key(std::uint32_t atom, PortId port) {
    return (std::uint64_t{atom} << 32) | port;
  }

  PortId intern_port(const std::string& name);
  void on_event(const Event& event);
  void deliver_internal(std::uint32_t atom);
  void deliver_external(std::uint32_t atom, const PortEvent& input);
  void reschedule(std::uint32_t atom);

  IEventScheduler& scheduler_;
  SimulationClock& clock_;
  EventHandlerRegistry handlers_;
  HandlerId dispatch_handler_{0};

  std::vector<AtomicModel*> atoms_;                        // borrowed
  // Coupled-scope (pass-through / root-inject) port names; atom ports are
  // resolved through each AtomicModel's own declare_port table.
  std::unordered_map<std::string, PortId> cpl_port_ids_;

  // Flattened routing.
  std::unordered_map<std::uint64_t, std::vector<RouteTarget>> out_routes_;
  std::unordered_map<PortId, std::vector<RouteTarget>> root_in_routes_;

  // Runtime state.
  std::vector<EventToken> pending_;
  std::vector<ExtInput> ext_inputs_;
  std::size_t dispatched_{0};
  std::size_t internal_budget_{0};
  std::size_t internal_transitions_{0};
};

}  // namespace logicpilot
