// Concrete process blocks (Method Runtime Layer, Phase 3).
//
// SourceBlock / QueueBlock / DelayBlock / ServiceBlock / SinkBlock implement
// the five primary PML kinds; GenericBlock carries the remaining kinds
// (split, selectOutput, count, hold, release, pass-through) with their
// existing semantics. Behavior mirrors the pre-modular engine exactly.
#pragma once

#include <cmath>
#include <cstdint>
#include <deque>
#include <functional>
#include <string>
#include <string_view>

#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/devs/mm1.h"  // TimeSampler
#include "process_block.h"

namespace logicpilot::process {

// Emits entities at the configured inter-arrival rate.
class SourceBlock final : public BufferedBlock {
 public:
  SourceBlock(std::string name, TimeSampler interarrival)
      : BufferedBlock("source", std::move(name), -1),
        interarrival_(std::move(interarrival)) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    if (!ctx.emit(entity, "out")) {
      return false;
    }
    input_.pop_front();
    ++departed_;
    return true;
  }

  double sample_gap(Xoshiro256PlusPlus& rng) override {
    return interarrival_(rng);
  }

 private:
  TimeSampler interarrival_;
};

// FIFO buffer (queue / wait): forwards immediately when downstream accepts.
class QueueBlock final : public BufferedBlock {
 public:
  QueueBlock(std::string name, std::int64_t capacity,
             std::string kind = "queue")
      : BufferedBlock(std::move(kind), std::move(name), capacity) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    if (!ctx.emit(entity, "out")) {
      return false;
    }
    input_.pop_front();
    ++departed_;
    return true;
  }
};

// Hold-and-forward (delay): occupies a delay slot for the sampled duration.
class DelayBlock final : public BufferedBlock {
 public:
  DelayBlock(std::string name, TimeSampler delay_time, std::int64_t capacity)
      : BufferedBlock("delay", std::move(name), capacity),
        delay_time_(std::move(delay_time)) {}

  bool can_accept() const override {
    return capacity_ < 0 ||
           static_cast<std::int64_t>(in_service_.size()) < capacity_;
  }

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    if (capacity_ >= 0 &&
        static_cast<std::int64_t>(in_service_.size()) >= capacity_) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    entity.service_start_ns = ctx.now().as_ns();
    in_service_.push_back(entity);
    const double hold = delay_time_(ctx.rng());
    ctx.schedule_depart(static_cast<std::int64_t>(
        std::llround(hold * 1e9)));
    return true;
  }

  void complete(BlockContext& ctx) override {
    if (in_service_.empty()) {
      return;
    }
    Entity entity = in_service_.front();
    in_service_.pop_front();
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
  }

  bool has_in_service() const override { return !in_service_.empty(); }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    in_service_.clear();
  }

 private:
  TimeSampler delay_time_;
  std::deque<Entity> in_service_;
};

// Server pool (service / seize): occupies a server for the sampled duration
// (seize holds for zero time and is released downstream).
class ServiceBlock final : public BufferedBlock {
 public:
  ServiceBlock(std::string name, std::int64_t servers,
               TimeSampler service_time, bool seize)
      : BufferedBlock(seize ? "seize" : "service", std::move(name), -1),
        servers_(servers),
        service_time_(std::move(service_time)),
        seize_(seize) {}

  bool can_accept() const override {
    return units_in_use_ < servers_;
  }

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    if (units_in_use_ >= servers_) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    entity.service_start_ns = ctx.now().as_ns();
    in_service_.push_back(entity);
    ++units_in_use_;
    ++busy_;
    const double hold =
        seize_ ? 0.0 : service_time_(ctx.rng());
    ctx.schedule_depart(static_cast<std::int64_t>(
        std::llround(hold * 1e9)));
    return true;
  }

  void complete(BlockContext& ctx) override {
    if (in_service_.empty()) {
      return;
    }
    Entity entity = in_service_.front();
    in_service_.pop_front();
    ++departed_;
    --units_in_use_;
    --busy_;
    if (!seize_) {
      ctx.record_service_wait(entity);
    }
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
  }

  [[nodiscard]] std::int64_t busy_units() const override { return busy_; }
  [[nodiscard]] std::int64_t pool_capacity() const override {
    return servers_;
  }

  void accumulate_areas(std::int64_t dt_ns) override {
    BufferedBlock::accumulate_areas(dt_ns);
    area_busy_ += static_cast<double>(dt_ns) * static_cast<double>(busy_);
  }

  void reset_stats() override {
    BufferedBlock::reset_stats();
    busy_ = 0;
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    in_service_.clear();
    units_in_use_ = 0;
    busy_ = 0;
  }

 private:
  std::int64_t servers_{1};
  TimeSampler service_time_;
  bool seize_{false};
  std::deque<Entity> in_service_;
  std::int64_t units_in_use_{0};
  std::int64_t busy_{0};
};

// Absorbs entities (records sojourn through BlockContext::leave_system).
class SinkBlock final : public BufferedBlock {
 public:
  explicit SinkBlock(std::string name)
      : BufferedBlock("sink", std::move(name), -1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    ++departed_;
    ctx.leave_system(entity);
    return true;
  }
};

// Remaining kinds with their existing semantics: selectOutput (RNG routing),
// split (clone to outCopy), hold (frozen = blocked), count/release/pass-
// through (immediate forward).
class GenericBlock final : public BufferedBlock {
 public:
  GenericBlock(std::string kind, std::string name, double probability,
               std::int64_t copies, bool frozen)
      : BufferedBlock(std::move(kind), std::move(name), -1),
        probability_(probability),
        copies_(copies),
        frozen_(frozen) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    if (kind_ == "selectOutput") {
      const double roll =
          static_cast<double>(ctx.rng()()) /
          static_cast<double>(UINT64_MAX);
      const bool take_true = roll < probability_;
      if (!ctx.emit(entity, take_true ? "outT" : "outF")) {
        return false;
      }
      input_.pop_front();
      ++departed_;
      return true;
    }
    if (kind_ == "split") {
      if (!ctx.emit(entity, "out")) {
        return false;
      }
      input_.pop_front();
      ++departed_;
      for (std::int64_t copy = 1; copy < copies_; ++copy) {
        Entity clone = entity;
        clone.id = entity.id * 1000 + static_cast<std::uint64_t>(copy);
        if (!ctx.emit(clone, "outCopy")) {
          outgoing_.push_back(clone);
        }
      }
      return true;
    }
    if (kind_ == "hold" && frozen_) {
      return false;
    }
    if (!ctx.emit(entity, "out")) {
      return false;
    }
    input_.pop_front();
    ++departed_;
    return true;
  }

 private:
  double probability_{0.5};
  std::int64_t copies_{2};
  bool frozen_{false};
};

}  // namespace logicpilot::process
