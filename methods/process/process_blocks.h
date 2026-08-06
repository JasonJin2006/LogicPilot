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
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

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
             std::int64_t capacity)
      : BufferedBlock("seize", std::move(name), capacity),
        resource_(std::move(resource)),
        quantity_(quantity > 0 ? quantity : 1) {}

  bool update(BlockContext& ctx) override {
    if (input_.empty()) {
      return false;
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

 private:
  std::string resource_;
  std::int64_t quantity_{1};
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
  explicit MatchBlock(std::string name)
      : BufferedBlock("match", std::move(name), -1) {}

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
