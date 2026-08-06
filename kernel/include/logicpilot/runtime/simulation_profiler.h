// Lightweight per-run profiler (P0: kernel observability).
//
// Counts dispatched events by type and measures wall-clock time for one
// SimulationKernel::run() replication. Deliberately cheap (a map increment
// per event); the benchmark gates stay the authority for throughput.
#pragma once

#include <chrono>
#include <cstdint>
#include <map>

#include "logicpilot/core/scheduler/event.h"

namespace logicpilot {

struct SimulationProfile {
  std::uint64_t events_dispatched{0};
  std::map<EventType, std::uint64_t> events_by_type;
  double wall_seconds{0.0};
};

class SimulationProfiler {
 public:
  void begin() {
    start_ = std::chrono::steady_clock::now();
    dispatched_ = 0;
    by_type_.clear();
  }

  void record_event(const Event& event) {
    ++dispatched_;
    ++by_type_[event.type];
  }

  SimulationProfile end() {
    const auto stop = std::chrono::steady_clock::now();
    SimulationProfile profile;
    profile.events_dispatched = dispatched_;
    profile.events_by_type = by_type_;
    profile.wall_seconds =
        std::chrono::duration<double>(stop - start_).count();
    return profile;
  }

 private:
  std::chrono::steady_clock::time_point start_{};
  std::uint64_t dispatched_{0};
  std::map<EventType, std::uint64_t> by_type_;
};

}  // namespace logicpilot
