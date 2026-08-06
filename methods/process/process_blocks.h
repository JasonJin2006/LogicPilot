// Concrete process blocks (Method Runtime Layer, Phase 3).
//
// SourceBlock / QueueBlock / DelayBlock / ServiceBlock / SinkBlock implement
// the five primary PML kinds; GenericBlock carries the remaining kinds
// (split, selectOutput, count, hold, release, pass-through) with their
// existing semantics. Behavior mirrors the pre-modular engine exactly.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <deque>
#include <functional>
#include <limits>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "logicpilot/devs/continuous.h"  // ExpressionEvaluator
#include "logicpilot/core/random/xoshiro256pp.h"
#include "logicpilot/core/random/distributions.h"
#include "logicpilot/devs/mm1.h"  // TimeSampler
#include "process_block.h"

namespace logicpilot::process {

// Emits entities at the configured inter-arrival rate.
class SourceBlock final : public BufferedBlock {
 public:
  SourceBlock(std::string name, TimeSampler interarrival,
              std::unordered_map<std::string, double> attributes)
      : BufferedBlock("source", std::move(name), -1),
        interarrival_(std::move(interarrival)),
        attributes_(std::move(attributes)) {}

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

  [[nodiscard]] const std::unordered_map<std::string, double>&
  attribute_defaults() const override {
    return attributes_;
  }

 private:
  TimeSampler interarrival_;
  std::unordered_map<std::string, double> attributes_;
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

// Numeric priority of an entity: the "priority" attribute when declared on
// the emitting source, otherwise the block's static agentPriority fallback.
inline double entity_priority(const Entity& entity, double fallback) {
  const auto it = entity.attributes.find("priority");
  return it != entity.attributes.end() ? it->second : fallback;
}

// Queue / Wait: FIFO (or LIFO / priority) buffer with optional exit-on-
// timeout and priority preemption (AnyLogic Queue/Wait semantics).
//   - queuing: "queuing_fifo" (default) / "queuing_lifo" / "queuing_priority";
//     "queuing_comparison" falls back to FIFO (no expression engine yet).
//   - priority: entity attribute "priority", falling back to the block's
//     agentPriority field; higher value = served first.
//   - enableTimeout: waiting entities exit through outTimeout after timeout.
//   - enablePreemption: queue-kind blocks eject their weakest waiter through
//     outPreempted when a full queue receives a higher-priority agent;
//     wait-kind blocks preempt on every arrival.
class WaitBlock final : public BufferedBlock {
 public:
  WaitBlock(std::string kind, std::string name, std::int64_t capacity,
            std::int64_t timeout_ns, bool enable_timeout,
            std::string queuing, double agent_priority,
            bool enable_preemption)
      : BufferedBlock(std::move(kind), std::move(name), capacity),
        timeout_ns_(timeout_ns),
        enable_timeout_(enable_timeout),
        queuing_(std::move(queuing)),
        agent_priority_(agent_priority),
        enable_preemption_(enable_preemption) {}

  bool can_accept(const Entity& entity) override {
    if (capacity_ < 0 ||
        static_cast<std::int64_t>(input_.size()) < capacity_) {
      return true;
    }
    // Full preempting queue: admit only a newcomer that outranks the agent
    // that would be ejected (lowest-priority waiter for priority queuing,
    // otherwise the most recent one).
    if (!enable_preemption_ || kind_ != "queue") {
      return false;
    }
    return priority_of(entity) > ejection_victim_priority();
  }

  void receive(const Entity& entity) override {
    BufferedBlock::receive(entity);
    last_received_id_ = entity.id;
  }

  bool update(BlockContext& ctx) override {
    if (enable_timeout_ && timeout_ns_ > 0) {
      for (const Entity& entity : input_) {
        if (timed_.insert(entity.id).second) {
          ctx.schedule_timeout(timeout_ns_, entity.id);
        }
      }
    }
    if (enable_preemption_ && kind_ == "wait") {
      preempt_new_arrivals(ctx);
    }
    if (queuing_ == "queuing_priority") {
      std::stable_sort(input_.begin(), input_.end(),
                       [this](const Entity& a, const Entity& b) {
                         return priority_of(a) > priority_of(b);
                       });
    }
    if (kind_ == "queue" && enable_preemption_ && capacity_ >= 0 &&
        static_cast<std::int64_t>(input_.size()) > capacity_) {
      eject_victim(ctx);  // can_accept admitted the outranking newcomer
    }
    if (input_.empty()) {
      return false;
    }
    Entity entity =
        queuing_ == "queuing_lifo" ? input_.back() : input_.front();
    if (!ctx.emit(entity, "out")) {
      return false;
    }
    if (queuing_ == "queuing_lifo") {
      input_.pop_back();
    } else {
      input_.pop_front();
    }
    ++departed_;
    return true;
  }

  void on_timeout(BlockContext& ctx, std::uint64_t entity_id) override {
    const auto it =
        std::find_if(input_.begin(), input_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == input_.end()) {
      return;  // the entity already left before its timeout
    }
    Entity entity = *it;
    input_.erase(it);
    timed_.erase(entity_id);
    ++departed_;
    if (!ctx.emit(entity, "outTimeout")) {
      alt_outgoing_.push_back({entity, "outTimeout"});
    }
  }

  bool retry_outgoing(BlockContext& ctx) override {
    if (!alt_outgoing_.empty()) {
      const auto entry = alt_outgoing_.front();
      if (ctx.emit(entry.first, entry.second.c_str())) {
        alt_outgoing_.pop_front();
        return true;
      }
      return false;
    }
    return BufferedBlock::retry_outgoing(ctx);
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    timed_.clear();
    queued_.clear();
    alt_outgoing_.clear();
  }

 private:
  double priority_of(const Entity& entity) const {
    return entity_priority(entity, agent_priority_);
  }

  double ejection_victim_priority() const {
    if (input_.empty()) {
      return -std::numeric_limits<double>::infinity();
    }
    if (queuing_ == "queuing_priority") {
      double lowest = priority_of(input_.front());
      for (const Entity& entity : input_) {
        lowest = std::min(lowest, priority_of(entity));
      }
      return lowest;
    }
    return priority_of(input_.back());
  }

  // The agent an arriving newcomer would preempt, per queuing policy
  // (priority: least priority; fifo: most recent; lifo: oldest). Only
  // established waiters (queued_) are candidates.
  const Entity* select_victim(std::uint64_t exclude_id) const {
    const Entity* victim = nullptr;
    double lowest = 0.0;
    for (const Entity& entity : input_) {
      if (entity.id == exclude_id ||
          queued_.find(entity.id) == queued_.end()) {
        continue;
      }
      if (queuing_ == "queuing_priority") {
        const double priority = priority_of(entity);
        if (victim == nullptr || priority < lowest) {
          victim = &entity;
          lowest = priority;
        }
      } else if (queuing_ == "queuing_lifo") {
        if (victim == nullptr) {
          victim = &entity;  // oldest first
        }
      } else {
        victim = &entity;  // fifo: the most recent one wins
      }
    }
    return victim;
  }

  void eject(BlockContext& ctx, const Entity& entity) {
    const auto it =
        std::find_if(input_.begin(), input_.end(),
                     [&entity](const Entity& entry) {
                       return entry.id == entity.id;
                     });
    if (it == input_.end()) {
      return;
    }
    Entity ejected = *it;  // copy before erase: the reference dies with it
    input_.erase(it);
    timed_.erase(ejected.id);
    queued_.erase(ejected.id);
    ++departed_;
    if (!ctx.emit(ejected, "outPreempted")) {
      alt_outgoing_.push_back({ejected, "outPreempted"});
    }
  }

  void eject_victim(BlockContext& ctx) {
    // Queue-kind waiters are all established (queued_ is only tracked for
    // wait-kind on-arrival preemption), so select without the filter.
    const Entity* victim = nullptr;
    double lowest = 0.0;
    for (const Entity& entity : input_) {
      if (entity.id == last_received_id_) {
        continue;
      }
      if (queuing_ == "queuing_priority") {
        const double priority = priority_of(entity);
        if (victim == nullptr || priority < lowest) {
          victim = &entity;
          lowest = priority;
        }
      } else {
        victim = &entity;  // fifo/lifo: the most recent one wins
      }
    }
    if (victim != nullptr) {
      eject(ctx, *victim);
    }
  }

  void preempt_new_arrivals(BlockContext& ctx) {
    std::vector<std::uint64_t> newcomers;
    for (const Entity& entity : input_) {
      if (queued_.find(entity.id) == queued_.end()) {
        newcomers.push_back(entity.id);
      }
    }
    for (const std::uint64_t id : newcomers) {
      const auto it =
          std::find_if(input_.begin(), input_.end(),
                       [id](const Entity& entry) { return entry.id == id; });
      if (it == input_.end()) {
        continue;
      }
      const Entity* victim = select_victim(id);
      if (victim != nullptr && priority_of(*it) > priority_of(*victim)) {
        eject(ctx, *victim);
      }
      queued_.insert(id);
    }
  }

  std::int64_t timeout_ns_{0};
  bool enable_timeout_{false};
  std::string queuing_;
  double agent_priority_{0.0};
  bool enable_preemption_{false};
  std::unordered_set<std::uint64_t> timed_;
  std::unordered_set<std::uint64_t> queued_;
  std::deque<std::pair<Entity, std::string>> alt_outgoing_;
  std::uint64_t last_received_id_{0};
};

// Hold-and-forward (delay): occupies a delay slot for the sampled duration.
class DelayBlock final : public BufferedBlock {
 public:
  DelayBlock(std::string name, TimeSampler delay_time, std::int64_t capacity)
      : BufferedBlock("delay", std::move(name), capacity),
        delay_time_(std::move(delay_time)) {}

  bool can_accept(const Entity&) override {
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
    ctx.schedule_depart(static_cast<std::int64_t>(std::llround(hold * 1e9)),
                        entity.id);
    return true;
  }

  void complete(BlockContext& ctx, std::uint64_t entity_id) override {
    if (in_service_.empty()) {
      return;
    }
    const auto it =
        std::find_if(in_service_.begin(), in_service_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == in_service_.end()) {
      return;
    }
    Entity entity = *it;
    in_service_.erase(it);
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
               TimeSampler service_time, bool seize,
               TimeSampler failure = {}, TimeSampler repair = {})
      : BufferedBlock(seize ? "seize" : "service", std::move(name), -1),
        servers_(servers),
        service_time_(std::move(service_time)),
        seize_(seize),
        failure_(std::move(failure)),
        repair_(std::move(repair)) {}

  bool can_accept(const Entity&) override {
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
    if (seize_) {
      ctx.schedule_depart(0, entity.id);
      return true;
    }
    schedule_service(ctx, entity.id);
    return true;
  }

  void complete(BlockContext& ctx, std::uint64_t entity_id) override {
    const auto it =
        std::find_if(in_service_.begin(), in_service_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == in_service_.end()) {
      return;
    }
    Entity entity = *it;
    in_service_.erase(it);
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

  // Milestone-1 busy-time failure semantics: while a unit is in service it
  // may fail (exponential time-to-failure); the service is preempted and
  // restarts from scratch after the repair (preemptive-repeat).
  void on_failure(BlockContext& ctx, std::uint64_t entity_id) override {
    if (!down_.insert(entity_id).second) {
      return;
    }
    --busy_;
    const double repair = repair_(ctx.rng());
    ctx.schedule_repair(static_cast<std::int64_t>(std::llround(repair * 1e9)),
                        entity_id);
  }

  void on_repair(BlockContext& ctx, std::uint64_t entity_id) override {
    if (down_.erase(entity_id) == 0) {
      return;
    }
    // Preemption-aware wait accounting (matches QueueingFlowSim): the
    // measured wait is arrival -> last (final) service start, so refresh the
    // start stamp on every repair-triggered restart.
    const auto it =
        std::find_if(in_service_.begin(), in_service_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it != in_service_.end()) {
      it->service_start_ns = ctx.now().as_ns();
    }
    ++busy_;
    schedule_service(ctx, entity_id);
  }

  [[nodiscard]] std::int64_t busy_units() const override { return busy_; }
  [[nodiscard]] std::int64_t pool_capacity() const override {
    return servers_;
  }

  void accumulate_areas(std::int64_t dt_ns) override {
    BufferedBlock::accumulate_areas(dt_ns);
    area_busy_ += static_cast<double>(dt_ns) * static_cast<double>(busy_);
    area_down_ +=
        static_cast<double>(dt_ns) * static_cast<double>(down_.size());
  }

  void reset_stats() override {
    BufferedBlock::reset_stats();
    busy_ = 0;
    area_down_ = 0.0;
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    in_service_.clear();
    units_in_use_ = 0;
    busy_ = 0;
    down_.clear();
  }

 private:
  void schedule_service(BlockContext& ctx, std::uint64_t entity_id) {
    const double hold = service_time_(ctx.rng());
    if (failure_) {
      const double failure_time = failure_(ctx.rng());
      if (failure_time < hold) {
        ctx.schedule_failure(
            static_cast<std::int64_t>(std::llround(failure_time * 1e9)),
            entity_id);
        return;
      }
    }
    ctx.schedule_depart(static_cast<std::int64_t>(std::llround(hold * 1e9)),
                        entity_id);
  }

  std::int64_t servers_{1};
  TimeSampler service_time_;
  bool seize_{false};
  TimeSampler failure_;
  TimeSampler repair_;
  std::deque<Entity> in_service_;
  std::unordered_set<std::uint64_t> down_;
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

// Exit: removes the incoming agent from the process flow (AnyLogic Exit);
// the agent leaves the system, sojourn recorded like a sink.
class ExitBlock final : public BufferedBlock {
 public:
  explicit ExitBlock(std::string name)
      : BufferedBlock("exit", std::move(name), -1) {}

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

// Enter: an entry point with no input port. In AnyLogic agents are injected
// programmatically (enter()); without an external API the block stays idle.
class EnterBlock final : public BufferedBlock {
 public:
  explicit EnterBlock(std::string name)
      : BufferedBlock("enter", std::move(name), -1) {}

  bool update(BlockContext&) override { return false; }
};

// Assembler (AnyLogic): waits until the main agent (in) and the required
// number of parts (p1, quantity `quantity125`) are present, then assembles
// for `delayTime` seconds and outputs the main agent. Multiple assemblies
// may run concurrently (unbounded delay-like capacity). Resource use during
// assembly is not modeled yet.
class AssemblerBlock final : public BufferedBlock {
 public:
  AssemblerBlock(std::string name, std::int64_t delay_ns,
                 std::int64_t parts_needed)
      : BufferedBlock("assembler", std::move(name), -1),
        delay_ns_(delay_ns),
        parts_needed_(parts_needed > 0 ? parts_needed : 1) {}

  void receive(const Entity& entity, std::string_view port) override {
    ++arrived_;
    if (port == "in") {
      main_.push_back(entity);
    } else {
      parts_.push_back(entity);
    }
  }

  bool update(BlockContext& ctx) override {
    if (main_.empty() ||
        parts_.size() < static_cast<std::size_t>(parts_needed_)) {
      return false;
    }
    Entity assembled = main_.front();
    main_.pop_front();
    for (std::int64_t i = 0; i < parts_needed_; ++i) {
      parts_.pop_front();
    }
    assembled.service_start_ns = ctx.now().as_ns();
    in_service_.push_back(assembled);
    ctx.schedule_depart(delay_ns_, assembled.id);
    return true;
  }

  void complete(BlockContext& ctx, std::uint64_t entity_id) override {
    const auto it =
        std::find_if(in_service_.begin(), in_service_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == in_service_.end()) {
      return;
    }
    Entity entity = *it;
    in_service_.erase(it);
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
  }

  [[nodiscard]] bool has_in_service() const override {
    return !in_service_.empty();
  }

  void accumulate_areas(std::int64_t dt_ns) override {
    BufferedBlock::accumulate_areas(dt_ns);
    area_occupancy_ += static_cast<double>(dt_ns) *
                       static_cast<double>(main_.size() + parts_.size());
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    main_.clear();
    parts_.clear();
    in_service_.clear();
  }

 private:
  std::int64_t delay_ns_{0};
  std::int64_t parts_needed_{1};
  std::deque<Entity> main_;
  std::deque<Entity> parts_;
  std::deque<Entity> in_service_;
};

// MoveTo (AnyLogic): moves the agent, spending `tripTime` (explicit) or
// distance/speed in the block. The lplib carries a single `xYZ` coordinate,
// so the speed mode moves along the x axis (|target - current| / speed);
// with neither set the agent jumps instantly (MODE_PLACE_TO).
class MoveToBlock final : public BufferedBlock {
 public:
  MoveToBlock(std::string name, std::int64_t trip_time_ns, double speed,
              double target_x)
      : BufferedBlock("moveTo", std::move(name), -1),
        trip_time_ns_(trip_time_ns),
        speed_(speed),
        target_x_(target_x) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    entity.service_start_ns = ctx.now().as_ns();
    in_service_.push_back(entity);
    std::int64_t hold_ns = trip_time_ns_;
    if (hold_ns <= 0 && speed_ > 0.0) {
      const double distance = std::abs(target_x_ - entity.x);
      hold_ns = static_cast<std::int64_t>(
          std::llround(distance / speed_ * 1e9));
    }
    ctx.schedule_depart(hold_ns, entity.id);
    return true;
  }

  void complete(BlockContext& ctx, std::uint64_t entity_id) override {
    const auto it =
        std::find_if(in_service_.begin(), in_service_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == in_service_.end()) {
      return;
    }
    Entity entity = *it;
    in_service_.erase(it);
    entity.x = target_x_;
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
  }

  [[nodiscard]] bool has_in_service() const override {
    return !in_service_.empty();
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    in_service_.clear();
  }

 private:
  std::int64_t trip_time_ns_{0};
  double speed_{0.0};
  double target_x_{0.0};
  std::deque<Entity> in_service_;
};

// Remaining kinds with their existing semantics: selectOutput (RNG routing),
// split (clone to outCopy), hold (frozen = blocked), count/release/pass-
// through (immediate forward).
class GenericBlock final : public BufferedBlock {
 public:
  GenericBlock(std::string kind, std::string name, double probability,
               std::int64_t copies, bool frozen,
               std::string condition_text = "",
               std::string blocking_condition = "",
               std::unordered_map<std::string, double> numeric_params = {})
      : BufferedBlock(std::move(kind), std::move(name), -1),
        probability_(probability),
        copies_(copies),
        frozen_(frozen),
        condition_text_(std::move(condition_text)),
        blocking_condition_(std::move(blocking_condition)),
        numeric_params_(std::move(numeric_params)) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    const Entity entity = input_.front();
    const auto lookup = [this, &ctx, &entity](const std::string& id) -> double {
      if (id == "t" || id == "time") {
        return static_cast<double>(ctx.now().as_ns()) * 1e-9;
      }
      const auto attribute = entity.attributes.find(id);
      if (attribute != entity.attributes.end()) {
        return attribute->second;
      }
      const auto it = numeric_params_.find(id);
      return it != numeric_params_.end() ? it->second : 0.0;
    };
    if (kind_ == "selectOutput") {
      bool take_true;
      if (!condition_text_.empty()) {
        // Runtime condition expression (ADR-0009 scripting Phase 1):
        // evaluated at routing time; nonzero means take the true branch.
        const ExpressionEvaluator evaluator{condition_text_};
        take_true = evaluator.eval(lookup) != 0.0;
      } else {
        const double roll =
            static_cast<double>(ctx.rng()()) /
            static_cast<double>(UINT64_MAX);
        take_true = roll < probability_;
      }
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
    if (kind_ == "hold") {
      bool blocked = frozen_;
      if (!blocked && !blocking_condition_.empty()) {
        const ExpressionEvaluator evaluator{blocking_condition_};
        blocked = evaluator.eval(lookup) != 0.0;
      }
      if (blocked) {
        return false;
      }
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
  std::string condition_text_;
  std::string blocking_condition_;
  std::unordered_map<std::string, double> numeric_params_;
};

// Seize: request `quantity` units from the named ResourcePool. The entity
// waits (embedded queue, capacity) until the pool grants the units, then
// leaves immediately with the units recorded on the entity; Release returns
// them. Semantics per AnyLogic Seize (resource pool + queue).
class SeizeBlock final : public BufferedBlock {
 public:
    SeizeBlock(std::string name, std::string resource, std::int64_t quantity,
               std::int64_t capacity, std::int64_t timeout_ns = 0,
               bool enable_timeout = false, bool enable_preemption = false)
        : BufferedBlock("seize", std::move(name), capacity),
          resource_(std::move(resource)),
          quantity_(quantity > 0 ? quantity : 1),
          timeout_ns_(timeout_ns),
          enable_timeout_(enable_timeout),
          enable_preemption_(enable_preemption) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
      if (enable_timeout_ && timeout_ns_ > 0) {
        for (const Entity& entity : input_) {
          if (timed_.insert(entity.id).second) {
            ctx.schedule_timeout(timeout_ns_, entity.id);
          }
        }
      }
      if (enable_preemption_) {
        preempt_new_arrivals(ctx);
      }
      if (!ctx.try_seize(resource_, quantity_)) {
      return false;  // pool exhausted: the entity stays in the queue
    }
    Entity entity = input_.front();
    input_.pop_front();
    entity.resources[resource_] += quantity_;
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
    return true;
  }

  void on_timeout(BlockContext& ctx, std::uint64_t entity_id) override {
    const auto it =
        std::find_if(input_.begin(), input_.end(),
                     [entity_id](const Entity& entry) {
                       return entry.id == entity_id;
                     });
    if (it == input_.end()) {
      return;  // already seized before the timeout fired
    }
    Entity entity = *it;
    input_.erase(it);
    timed_.erase(entity_id);
    ++departed_;
      if (!ctx.emit(entity, "outTimeout")) {
        alt_outgoing_.push_back({entity, "outTimeout"});
      }
    }

    bool retry_outgoing(BlockContext& ctx) override {
      if (!alt_outgoing_.empty()) {
        const auto entry = alt_outgoing_.front();
        if (ctx.emit(entry.first, entry.second.c_str())) {
          alt_outgoing_.pop_front();
          return true;
        }
        return false;
    }
    return BufferedBlock::retry_outgoing(ctx);
  }

    void clear_buffers() override {
      BufferedBlock::clear_buffers();
      timed_.clear();
      queued_.clear();
      alt_outgoing_.clear();
    }

    [[nodiscard]] std::string pool_resource() const override {
      return resource_;
    }

   private:
    // Preemption on arrival (AnyLogic Seize embedded queue): a newcomer
    // with higher priority than the weakest established waiter ejects it
    // through outPreempted and takes its place.
    void preempt_new_arrivals(BlockContext& ctx) {
      std::vector<std::uint64_t> newcomers;
      for (const Entity& entity : input_) {
        if (queued_.find(entity.id) == queued_.end()) {
          newcomers.push_back(entity.id);
        }
      }
      for (const std::uint64_t id : newcomers) {
        const auto it =
            std::find_if(input_.begin(), input_.end(),
                         [id](const Entity& entry) { return entry.id == id; });
        if (it == input_.end()) {
          continue;
        }
        const Entity* victim = nullptr;
        double lowest = 0.0;
        for (const Entity& waiter : input_) {
          if (waiter.id == id ||
              queued_.find(waiter.id) == queued_.end()) {
            continue;
          }
          const double priority = entity_priority(waiter, 0.0);
          if (victim == nullptr || priority < lowest) {
            victim = &waiter;
            lowest = priority;
          }
        }
        if (victim != nullptr &&
            entity_priority(*it, 0.0) > entity_priority(*victim, 0.0)) {
          eject(ctx, *victim);
        }
        queued_.insert(id);
      }
    }

    void eject(BlockContext& ctx, const Entity& entity) {
      const auto it =
          std::find_if(input_.begin(), input_.end(),
                       [&entity](const Entity& entry) {
                         return entry.id == entity.id;
                       });
      if (it == input_.end()) {
        return;
      }
      Entity ejected = *it;  // copy before erase: the reference dies with it
      input_.erase(it);
      timed_.erase(ejected.id);
      queued_.erase(ejected.id);
      ++departed_;
      if (!ctx.emit(ejected, "outPreempted")) {
        alt_outgoing_.push_back({ejected, "outPreempted"});
      }
    }

    std::string resource_;
    std::int64_t quantity_{1};
    std::int64_t timeout_ns_{0};
    bool enable_timeout_{false};
    bool enable_preemption_{false};
    std::unordered_set<std::uint64_t> timed_;
    std::unordered_set<std::uint64_t> queued_;
    std::deque<std::pair<Entity, std::string>> alt_outgoing_;
  };

// Release: return every resource unit the entity holds to its pool (zero
// time). Semantics per AnyLogic Release ("all seized resources must be
// released before the agent is disposed of").
class ReleaseBlock final : public BufferedBlock {
 public:
  explicit ReleaseBlock(std::string name)
      : BufferedBlock("release", std::move(name), -1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    for (const auto& [resource, quantity] : entity.resources) {
      ctx.release_resources(resource, quantity);
    }
    entity.resources.clear();
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
    return true;
  }
};

// Batch: accumulate `batchSize` agents, then form one batch agent that leaves
// immediately. Permanent batches discard the originals (empty contents);
// temporary batches carry the originals as contents so Unbatch restores them.
class BatchBlock final : public BufferedBlock {
 public:
  BatchBlock(std::string name, std::int64_t batch_size, bool permanent)
      : BufferedBlock("batch", std::move(name), -1),
        batch_size_(batch_size > 0 ? batch_size : 1),
        permanent_(permanent) {}

  bool update(BlockContext& ctx) override {
    if (input_.size() < static_cast<std::size_t>(batch_size_)) {
      return false;
    }
    Entity batch = input_.front();
    batch.service_start_ns = ctx.now().as_ns();
    if (!permanent_) {
      batch.contents.reserve(static_cast<std::size_t>(batch_size_));
      for (std::int64_t i = 0; i < batch_size_; ++i) {
        batch.contents.push_back(input_.front());
        input_.pop_front();
      }
    } else {
      for (std::int64_t i = 0; i < batch_size_; ++i) {
        input_.pop_front();
      }
    }
    ++departed_;
    if (!ctx.emit(batch, "out")) {
      outgoing_.push_back(batch);
    }
    return true;
  }

 private:
  std::int64_t batch_size_{1};
  bool permanent_{false};
};

// Unbatch: extract all contents of the incoming batch agent and forward them
// (zero time). A permanent batch (or a plain agent) has no contents and is
// consumed without output. Semantics per AnyLogic Unbatch.
class UnbatchBlock final : public BufferedBlock {
 public:
  explicit UnbatchBlock(std::string name)
      : BufferedBlock("unbatch", std::move(name), -1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity batch = input_.front();
    input_.pop_front();
    ++departed_;
    if (batch.contents.empty()) {
      return true;  // permanent batch / plain agent: consumed, no output
    }
    std::vector<Entity> contents = std::move(batch.contents);
    for (std::size_t i = 0; i < contents.size(); ++i) {
      if (!ctx.emit(contents[i], "out")) {
        // Downstream is full: keep this and the remaining contents for the
        // engine's retry pass.
        for (; i < contents.size(); ++i) {
          outgoing_.push_back(contents[i]);
        }
        return true;
      }
    }
    return true;
  }
};

// Combine: wait for one agent on in1 and one on in2 (any order), then create
// the combined agent (combineMode: new / entity1 / entity2) and output it.
// Zero time. Semantics per AnyLogic Combine.
class CombineBlock final : public BufferedBlock {
 public:
  CombineBlock(std::string name, std::string combine_mode)
      : BufferedBlock("combine", std::move(name), -1),
        combine_mode_(std::move(combine_mode)) {}

  void receive(const Entity& entity, std::string_view port) override {
    ++arrived_;
    if (port == "in2") {
      input2_.push_back(entity);
    } else {
      input1_.push_back(entity);
    }
  }

  bool update(BlockContext& ctx) override {
    if (input1_.empty() || input2_.empty()) {
      return false;
    }
    Entity first = input1_.front();
    Entity second = input2_.front();
    input1_.pop_front();
    input2_.pop_front();
    Entity combined;
    const std::string mode =
        combine_mode_ == "entity1" || combine_mode_ == "agent1"
            ? "entity1"
            : combine_mode_ == "entity2" || combine_mode_ == "agent2"
                  ? "entity2"
                  : "new";
    if (mode == "entity1") {
      combined = first;
    } else if (mode == "entity2") {
      combined = second;
    } else {
      combined = first;  // new agent: carries the first agent's identity
      combined.contents.clear();
      combined.resources.clear();
      combined.has_measure = false;
      combined.service_start_ns = ctx.now().as_ns();
    }
    ++departed_;
    if (!ctx.emit(combined, "out")) {
      outgoing_.push_back(combined);
    }
    return true;
  }

    void accumulate_areas(std::int64_t dt_ns) override {
      BufferedBlock::accumulate_areas(dt_ns);
      area_occupancy_ += static_cast<double>(dt_ns) *
                         static_cast<double>(input1_.size() + input2_.size());
    }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    input1_.clear();
    input2_.clear();
  }

 private:
  std::string combine_mode_;
  std::deque<Entity> input1_;
  std::deque<Entity> input2_;
};

// Match: synchronize two streams. Agents wait in per-stream queues; when both
// queues are non-empty the front pair exits together on out1/out2 (FIFO,
// matching AnyLogic's default match condition `true` = pure synchronizer).
class MatchBlock final : public BufferedBlock {
 public:
  explicit MatchBlock(std::string name, std::string condition)
      : BufferedBlock("match", std::move(name), -1),
        condition_(std::move(condition)) {}

  void receive(const Entity& entity, std::string_view port) override {
    ++arrived_;
    if (port == "in2") {
      input2_.push_back(entity);
      pending_new_ = {entity.id, 2};
    } else {
      input1_.push_back(entity);
      pending_new_ = {entity.id, 1};
    }
  }

  bool update(BlockContext& ctx) override {
    if (!condition_.empty()) {
      return update_conditioned(ctx);
    }
    if (input1_.empty() || input2_.empty()) {
      return false;
    }
    const Entity first = input1_.front();
    const Entity second = input2_.front();
    // Both branches must accept so the pair exits atomically (AnyLogic: both
    // agents exit at the same time).
    if (!ctx.downstream_accepts(first, "out1") ||
        !ctx.downstream_accepts(second, "out2")) {
      return false;
    }
    input1_.pop_front();
    input2_.pop_front();
    ctx.emit(first, "out1");
    ctx.emit(second, "out2");
    departed_ += 2;
    return true;
  }

  // Pairing on an entity attribute (AnyLogic `matchCondition`: here the
  // field names the attribute; agents pair when their values are equal).
  // The arriving agent is checked against the opposite queue front-to-back,
  // matching AnyLogic's "checked against all agents in the other queue".
  bool update_conditioned(BlockContext& ctx) {
    if (pending_new_.id == std::numeric_limits<std::uint64_t>::max()) {
      return false;
    }
    const bool newcomer_in_1 = pending_new_.port == 1;
    const std::uint64_t newcomer_id = pending_new_.id;
    pending_new_ = {std::numeric_limits<std::uint64_t>::max(), 0};

    auto& own_queue = newcomer_in_1 ? input1_ : input2_;
    auto& other_queue = newcomer_in_1 ? input2_ : input1_;
    const auto newcomer =
        std::find_if(own_queue.begin(), own_queue.end(),
                     [newcomer_id](const Entity& entry) {
                       return entry.id == newcomer_id;
                     });
    if (newcomer == own_queue.end() || other_queue.empty()) {
      return false;
    }
    const double own_value = attribute_value(*newcomer);
    for (auto it = other_queue.begin(); it != other_queue.end(); ++it) {
      if (attribute_value(*it) != own_value) {
        continue;
      }
      if (!ctx.downstream_accepts(*newcomer, "out1") ||
          !ctx.downstream_accepts(*it, "out2")) {
        return false;
      }
      const Entity partner = *it;
      const Entity first = *newcomer;
      other_queue.erase(it);
      own_queue.erase(newcomer);
      ctx.emit(first, "out1");
      ctx.emit(partner, "out2");
      departed_ += 2;
      return true;
    }
    return false;
  }

  void accumulate_areas(std::int64_t dt_ns) override {
    BufferedBlock::accumulate_areas(dt_ns);
    area_occupancy_ += static_cast<double>(dt_ns) *
                       static_cast<double>(input1_.size() + input2_.size());
  }

  void clear_buffers() override {
    BufferedBlock::clear_buffers();
    input1_.clear();
    input2_.clear();
  }

 private:
  double attribute_value(const Entity& entity) const {
    const auto it = entity.attributes.find(condition_);
    return it != entity.attributes.end() ? it->second : 0.0;
  }

  std::string condition_;
  struct PendingNew {
    std::uint64_t id{std::numeric_limits<std::uint64_t>::max()};
    int port{0};
  };
  PendingNew pending_new_;
  std::deque<Entity> input1_;
  std::deque<Entity> input2_;
};

// TimeMeasureStart: stamp the entity's measurement timestamp (kept from the
// first start it passes). Zero time.
class TimeMeasureStartBlock final : public BufferedBlock {
 public:
  explicit TimeMeasureStartBlock(std::string name)
      : BufferedBlock("timeMeasureStart", std::move(name), -1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    if (!entity.has_measure) {
      entity.measure_start_ns = ctx.now().as_ns();
      entity.has_measure = true;
    }
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
    return true;
  }
};

// TimeMeasureEnd: measure the time since the paired TimeMeasureStart and
// record it in the run metrics. Zero time.
class TimeMeasureEndBlock final : public BufferedBlock {
 public:
  explicit TimeMeasureEndBlock(std::string name)
      : BufferedBlock("timeMeasureEnd", std::move(name), -1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
    }
    Entity entity = input_.front();
    input_.pop_front();
    if (entity.has_measure) {
      const double elapsed =
          static_cast<double>(ctx.now().as_ns() - entity.measure_start_ns) *
          1e-9;
      ctx.record_measure(entity, elapsed);
      entity.has_measure = false;
    }
    ++departed_;
    if (!ctx.emit(entity, "out")) {
      outgoing_.push_back(entity);
    }
    return true;
  }
};

}  // namespace logicpilot::process
