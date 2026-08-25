// Continuous ODE engine (see continuous.h).
#include "logicpilot/devs/continuous.h"

#include <algorithm>
#include <bit>
#include <cctype>
#include <cmath>
#include <cstring>
#include <limits>
#include <utility>

#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

namespace v2 = logicpilot::ir::v2;

const v2::Node* find_sd_node(const v2::Node* node) {
  if (node == nullptr)
    return nullptr;
  if (node->semantics() != nullptr && node->semantics()->library() != nullptr &&
      node->semantics()->library()->str() == "sd" && node->continuous() != nullptr) {
    return node;
  }
  if (node->children() != nullptr) {
    for (const v2::Node* child : *node->children()) {
      if (const v2::Node* found = find_sd_node(child); found != nullptr) {
        return found;
      }
    }
  }
  return nullptr;
}

constexpr std::uint32_t kContinuousCheckpointMagic = 0x4C505344U;  // LPSD
constexpr std::uint8_t kContinuousCheckpointVersion = 4;
constexpr std::uint32_t kMaxZeroCrossings = 1'000'000;
constexpr EventType kContinuousLogicalStep = 0xFFFF1002U;

void append_u32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  for (int byte = 0; byte < 4; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

void append_u64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  for (int byte = 0; byte < 8; ++byte) {
    out.push_back(static_cast<std::uint8_t>(value >> (byte * 8)));
  }
}

bool read_u32(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint32_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 4) return false;
  value = 0;
  for (int byte = 0; byte < 4; ++byte) {
    value |= static_cast<std::uint32_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

bool read_u8(std::span<const std::uint8_t> bytes, std::size_t& offset,
             std::uint8_t& value) {
  if (offset >= bytes.size()) return false;
  value = bytes[offset++];
  return true;
}

bool read_u64(std::span<const std::uint8_t> bytes, std::size_t& offset,
              std::uint64_t& value) {
  if (offset > bytes.size() || bytes.size() - offset < 8) return false;
  value = 0;
  for (int byte = 0; byte < 8; ++byte) {
    value |= static_cast<std::uint64_t>(bytes[offset++]) << (byte * 8);
  }
  return true;
}

void append_string(std::vector<std::uint8_t>& out, const std::string& value) {
  append_u32(out, static_cast<std::uint32_t>(value.size()));
  out.insert(out.end(), value.begin(), value.end());
}

bool read_string(std::span<const std::uint8_t> bytes, std::size_t& offset,
                 std::string& value) {
  std::uint32_t size = 0;
  if (!read_u32(bytes, offset, size) || size > bytes.size() - offset) {
    return false;
  }
  value.assign(reinterpret_cast<const char*>(bytes.data() + offset), size);
  offset += size;
  return true;
}

}  // namespace

// ---------------------------------------------------------------------------

ContinuousReplicationModel::ContinuousReplicationModel(std::vector<std::uint8_t> v2_bytes,
                                                       const v2::Node* /*v2_root*/)
    : bytes_{std::move(v2_bytes)} {
  const v2::Node* root = ir::v2::GetModelFile(bytes_.data())->root();
  v2_root_ = find_sd_node(root);
  if (v2_root_ != nullptr && v2_root_->params() != nullptr) {
    for (const v2::Var* var : *v2_root_->params()) {
      if (var->name() != nullptr && var->type() == v2::VarType_Float) {
        params_[var->name()->str()] = var->float_value();
      }
    }
  }
  if (v2_root_ != nullptr && v2_root_->continuous() != nullptr) {
    for (const v2::Equation* equation : *v2_root_->continuous()) {
      if (equation->lhs() == nullptr || equation->rhs_text() == nullptr) {
        continue;
      }
      Ode ode;
      ode.var = equation->lhs()->str();
      ode.rhs_text = equation->rhs_text()->str();
      ode.initial = equation->initial_value();
      odes_.push_back(std::move(ode));
    }
  }
}

ReplicationMetrics ContinuousReplicationModel::run(const ReplicationConfig& config,
                                                   TraceRecorder* trace) {
  trace_ = trace;
  if (!reset(config)) {
    trace_ = nullptr;
    return ReplicationMetrics{};
  }
  while (step()) {
  }
  ReplicationMetrics result = finish(trace);
  trace_ = nullptr;
  return result;
}

bool ContinuousReplicationModel::reset(const ReplicationConfig& config) {
  state_.clear();
  evaluators_.clear();
  y_.clear();
  variables_.clear();
  trajectory_.clear();
  last_state_.clear();
  error_.clear();
  budget_exhausted_ = false;
  active_ = false;
  adaptive_ = false;
  absolute_tolerance_ = 1e-9;
  relative_tolerance_ = 1e-6;
  minimum_step_ = 1e-12;
  maximum_step_ = static_cast<double>(kStepNs) * 1e-9;
  proposed_step_ = maximum_step_;
  target_horizon_ = 0.0;
  maximum_step_count_ = 0;
  last_step_seconds_ = 0.0;
  max_local_error_ = 0.0;
  prepared_step_ = 0.0;
  detect_zero_crossings_ = false;
  stop_at_zero_crossings_ = false;
  zero_crossings_.clear();
  if (odes_.empty()) {
    error_ = "no continuous equations to integrate";
    return false;
  }

  for (const Ode& ode : odes_) {
    if (!std::isfinite(ode.initial)) {
      error_ = "initial state for '" + ode.var + "' is non-finite";
      return false;
    }
    state_[ode.var] = ode.initial;
    ExpressionEvaluator evaluator{ode.rhs_text};
    if (!evaluator.ok()) {
      error_ = "invalid equation for '" + ode.var + "': " + evaluator.error();
      return false;
    }
    evaluators_.push_back(std::move(evaluator));
    variables_.push_back(ode.var);
    y_.push_back(ode.initial);
    last_state_[ode.var] = ode.initial;
  }
  requested_step_budget_ = config.arrivals;
  step_budget_ = std::min(config.arrivals, config.max_events);
  step_index_ = 0;
  current_t_ = 0.0;
  const auto numeric_param = [&](const char* name, double fallback) {
    const auto it = params_.find(name);
    return it == params_.end() ? fallback : it->second;
  };
  adaptive_ = numeric_param("adaptive", 0.0) > 0.5;
  detect_zero_crossings_ = numeric_param("detect_zero_crossings", 0.0) > 0.5;
  stop_at_zero_crossings_ = numeric_param("stop_at_zero_crossings", 0.0) > 0.5;
  if (adaptive_) {
    absolute_tolerance_ = numeric_param("absolute_tolerance", absolute_tolerance_);
    relative_tolerance_ = numeric_param("relative_tolerance", relative_tolerance_);
    maximum_step_ = numeric_param("maximum_step", maximum_step_);
    minimum_step_ = numeric_param("minimum_step", minimum_step_);
    target_horizon_ = numeric_param(
        "horizon", static_cast<double>(step_budget_) * maximum_step_);
    if (!(std::isfinite(absolute_tolerance_) && absolute_tolerance_ > 0.0) ||
        !(std::isfinite(relative_tolerance_) && relative_tolerance_ > 0.0) ||
        !(std::isfinite(minimum_step_) && minimum_step_ > 0.0) ||
        !(std::isfinite(maximum_step_) && maximum_step_ >= minimum_step_) ||
        !(std::isfinite(target_horizon_) && target_horizon_ >= 0.0)) {
      error_ = "invalid adaptive solver parameters (tolerances/step/horizon)";
      return false;
    }
    proposed_step_ = std::min(maximum_step_,
                              target_horizon_ > 0.0 ? target_horizon_ : maximum_step_);
    // A pathological tolerance must fail deterministically rather than loop
    // forever. Normal models never approach this guard.
    constexpr std::uint64_t kAdaptiveStepMultiplier = 10'000;
    maximum_step_count_ = step_budget_ >
                                  std::numeric_limits<std::uint64_t>::max() /
                                      kAdaptiveStepMultiplier
                              ? std::numeric_limits<std::uint64_t>::max()
                              : step_budget_ * kAdaptiveStepMultiplier;
  } else {
    target_horizon_ = static_cast<double>(step_budget_) * maximum_step_;
  }
  trajectory_.reserve(static_cast<std::size_t>(step_budget_));
  active_ = true;
  return true;
}

bool ContinuousReplicationModel::checkpoint_save(
    std::vector<std::uint8_t>& state) const {
  if ((!active_ && !budget_exhausted_) ||
      (!error_.empty() && !budget_exhausted_) ||
      variables_.size() != y_.size() ||
      variables_.size() > std::numeric_limits<std::uint32_t>::max()) {
    return false;
  }
  state.clear();
  append_u32(state, kContinuousCheckpointMagic);
  state.push_back(kContinuousCheckpointVersion);
  append_u64(state, step_budget_);
  append_u64(state, requested_step_budget_);
  state.push_back(budget_exhausted_ ? 1 : 0);
  append_u64(state, step_index_);
  append_u64(state, std::bit_cast<std::uint64_t>(current_t_));
  state.push_back(adaptive_ ? 1 : 0);
  append_u64(state, std::bit_cast<std::uint64_t>(proposed_step_));
  append_u64(state, std::bit_cast<std::uint64_t>(target_horizon_));
  append_u64(state, std::bit_cast<std::uint64_t>(max_local_error_));
  state.push_back(detect_zero_crossings_ ? 1 : 0);
  if (zero_crossings_.size() > kMaxZeroCrossings) return false;
  append_u32(state, static_cast<std::uint32_t>(zero_crossings_.size()));
  for (const ContinuousZeroCrossing& crossing : zero_crossings_) {
    append_string(state, crossing.variable);
    append_u64(state, std::bit_cast<std::uint64_t>(crossing.at));
    append_u64(state, std::bit_cast<std::uint64_t>(crossing.before));
    append_u64(state, std::bit_cast<std::uint64_t>(crossing.after));
    state.push_back(static_cast<std::uint8_t>(crossing.direction));
  }
  append_u32(state, static_cast<std::uint32_t>(variables_.size()));
  for (std::size_t index = 0; index < variables_.size(); ++index) {
    append_string(state, variables_[index]);
    append_u64(state, std::bit_cast<std::uint64_t>(y_[index]));
  }
  state.push_back(active_ ? 1 : 0);
  return true;
}

bool ContinuousReplicationModel::checkpoint_restore(
    std::span<const std::uint8_t> state) {
  std::size_t offset = 0;
  std::uint32_t magic = 0;
  std::uint8_t version = 0;
  std::uint64_t budget = 0, requested_budget = 0;
  std::uint64_t step = 0;
  std::uint64_t raw_time = 0;
  std::uint32_t count = 0;
  if (!read_u32(state, offset, magic) || magic != kContinuousCheckpointMagic ||
      offset >= state.size() || (version = state[offset++]) == 0 ||
      (version < 1 || version > kContinuousCheckpointVersion) ||
      !read_u64(state, offset, budget)) {
    return false;
  }
  bool restored_adaptive = false;
  double restored_proposed_step = maximum_step_;
  double restored_target_horizon = static_cast<double>(budget) * maximum_step_;
  double restored_max_local_error = 0.0;
  bool restored_detect_crossings = false;
  std::vector<ContinuousZeroCrossing> restored_crossings;
  bool restored_budget_exhausted = false;
  if (version >= 4) {
    if (!read_u64(state, offset, requested_budget) || offset >= state.size()) {
      return false;
    }
    restored_budget_exhausted = state[offset++] != 0;
  }
  if (!read_u64(state, offset, step) || !read_u64(state, offset, raw_time)) {
    return false;
  }
  if (version >= 2) {
    // The adaptive section follows the common magic/version/budget/step/time
    // prefix: one flag and three IEEE-754 doubles.
    if (offset >= state.size()) return false;
    restored_adaptive = state[offset++] != 0;
    std::uint64_t raw_proposed = 0, raw_target = 0, raw_error = 0;
    if (!read_u64(state, offset, raw_proposed) || !read_u64(state, offset, raw_target) ||
        !read_u64(state, offset, raw_error)) return false;
    restored_proposed_step = std::bit_cast<double>(raw_proposed);
    restored_target_horizon = std::bit_cast<double>(raw_target);
    restored_max_local_error = std::bit_cast<double>(raw_error);
  }
  if (version >= 3) {
    std::uint32_t crossing_count = 0;
    if (offset >= state.size()) return false;
    restored_detect_crossings = state[offset++] != 0;
    if (!read_u32(state, offset, crossing_count) || crossing_count > kMaxZeroCrossings)
      return false;
    restored_crossings.reserve(crossing_count);
    for (std::uint32_t index = 0; index < crossing_count; ++index) {
      ContinuousZeroCrossing crossing;
      std::uint64_t raw_at = 0, raw_before = 0, raw_after = 0;
      std::uint8_t direction = 0;
      if (!read_string(state, offset, crossing.variable) ||
          !read_u64(state, offset, raw_at) || !read_u64(state, offset, raw_before) ||
          !read_u64(state, offset, raw_after) || !read_u8(state, offset, direction) ||
          direction > static_cast<std::uint8_t>(ZeroCrossingDirection::kDownward)) {
        return false;
      }
      crossing.at = std::bit_cast<double>(raw_at);
      crossing.before = std::bit_cast<double>(raw_before);
      crossing.after = std::bit_cast<double>(raw_after);
      if (!std::isfinite(crossing.at) || !std::isfinite(crossing.before) ||
          !std::isfinite(crossing.after)) return false;
      crossing.direction = static_cast<ZeroCrossingDirection>(direction);
      restored_crossings.push_back(std::move(crossing));
    }
  }
  if (!read_u32(state, offset, count) || count != variables_.size()) return false;
  std::unordered_map<std::string, double> restored_state;
  std::vector<double> restored_y;
  restored_y.reserve(count);
  for (std::uint32_t index = 0; index < count; ++index) {
    std::string name;
    std::uint64_t raw = 0;
    if (!read_string(state, offset, name) || !read_u64(state, offset, raw)) {
      return false;
    }
    if (name != variables_[index] || restored_state.contains(name)) {
      return false;
    }
    const double value = std::bit_cast<double>(raw);
    if (!std::isfinite(value)) return false;
    restored_state.emplace(name, value);
    restored_y.push_back(value);
  }
  if (offset >= state.size()) return false;
  const bool active = state[offset++] != 0;
  if (offset != state.size()) return false;

  if (restored_adaptive != adaptive_ ||
      (version >= 3 && restored_detect_crossings != detect_zero_crossings_) ||
      !std::isfinite(restored_proposed_step) ||
      restored_proposed_step <= 0.0 || !std::isfinite(restored_target_horizon) ||
      restored_target_horizon < 0.0 || !std::isfinite(restored_max_local_error) ||
      restored_max_local_error < 0.0) {
    return false;
  }
  step_budget_ = budget;
  requested_step_budget_ = version >= 4 ? requested_budget : budget;
  step_index_ = step;
  current_t_ = std::bit_cast<double>(raw_time);
  if (!std::isfinite(current_t_)) return false;
  state_ = std::move(restored_state);
  y_ = std::move(restored_y);
  last_state_ = state_;
  proposed_step_ = restored_proposed_step;
  prepared_step_ = 0.0;
  target_horizon_ = restored_target_horizon;
  max_local_error_ = restored_max_local_error;
  zero_crossings_ = std::move(restored_crossings);
  last_step_seconds_ = 0.0;
  trajectory_.clear();
  budget_exhausted_ = version >= 4 && restored_budget_exhausted;
  error_ = budget_exhausted_
               ? "KR1017: shared integration step budget exhausted (" +
                     std::to_string(step_budget_) + " steps)"
               : std::string{};
  active_ = active;
  return true;
}

double ContinuousReplicationModel::next_step_seconds() const {
  if (!adaptive_) return static_cast<double>(kStepNs) * 1e-9;
  if (done()) return 0.0;
  const double step = prepared_step_ > 0.0 ? prepared_step_ : proposed_step_;
  return std::min(step, std::max(0.0, target_horizon_ - current_t_));
}

bool ContinuousReplicationModel::prepare_next_step() {
  if (!adaptive_ || done()) return true;
  if (prepared_step_ > 0.0) return true;
  double h = std::min(proposed_step_, target_horizon_ - current_t_);
  if (!(h > 0.0) || !std::isfinite(h)) {
    error_ = "adaptive RK4 produced an invalid proposed step";
    active_ = false;
    return false;
  }
  bool crossing_clipped = false;
  for (int attempt = 0; attempt < 64; ++attempt) {
    std::vector<double> full, half, refined;
    std::string trial_error;
    if (!rk4_trial(y_, current_t_, h, full, &trial_error) ||
        !rk4_trial(y_, current_t_, h * 0.5, half, &trial_error) ||
        !rk4_trial(half, current_t_ + h * 0.5, h * 0.5, refined, &trial_error)) {
      error_ = trial_error.empty() ? "adaptive RK4 preflight failed" : trial_error;
      active_ = false;
      return false;
    }
    double normalized_error = 0.0;
    for (std::size_t i = 0; i < y_.size(); ++i) {
      const double scale = absolute_tolerance_ +
                           relative_tolerance_ * std::max(std::abs(y_[i]),
                                                           std::abs(refined[i]));
      normalized_error = std::max(normalized_error,
                                  std::abs(refined[i] - full[i]) / scale);
    }
    if (detect_zero_crossings_ && stop_at_zero_crossings_ && !crossing_clipped) {
      double fraction = 1.0;
      for (std::size_t i = 0; i < y_.size(); ++i) {
        const double left = y_[i];
        const double right = refined[i];
        if ((left < 0.0 && right >= 0.0) || (left > 0.0 && right <= 0.0)) {
          const double denominator = std::abs(left) + std::abs(right);
          fraction = std::min(fraction, denominator == 0.0
                                           ? 0.5
                                           : std::abs(left) / denominator);
        }
      }
      if (fraction < 1.0) {
        h = std::max(minimum_step_, h * std::clamp(fraction, 0.0, 1.0));
        crossing_clipped = true;
        continue;
      }
    }
    if (normalized_error <= 1.0 || h <= minimum_step_ * (1.0 + 1e-12)) {
      prepared_step_ = h;
      return true;
    }
    h *= std::clamp(0.9 * std::pow(normalized_error, -0.2), 0.1, 0.5);
    if (h < minimum_step_) break;
  }
  error_ = "adaptive RK4 minimum step reached during preflight at t=" +
           std::to_string(current_t_);
  active_ = false;
  return false;
}

bool ContinuousReplicationModel::rk4_trial(const std::vector<double>& input,
                                           double t, double h,
                                           std::vector<double>& output,
                                           std::string* error) const {
  const std::size_t count = odes_.size();
  if (input.size() != count || !(std::isfinite(t) && std::isfinite(h)) || h <= 0.0) {
    if (error != nullptr) *error = "invalid RK4 trial interval";
    return false;
  }
  const auto lookup = [&](const std::vector<double>& values, double at,
                          const std::string& name) {
    if (name == "t") return at;
    const auto param = params_.find(name);
    if (param != params_.end()) return param->second;
    for (std::size_t i = 0; i < count; ++i) {
      if (odes_[i].var == name) return values[i];
    }
    return 0.0;
  };
  const auto derivatives = [&](const std::vector<double>& values, double at,
                               std::vector<double>& out, const char* stage) {
    out.resize(count);
    for (std::size_t i = 0; i < count; ++i) {
      out[i] = evaluators_[i].eval(
          [&](const std::string& name) { return lookup(values, at, name); });
      if (!std::isfinite(out[i])) {
        if (error != nullptr) {
          *error = "non-finite derivative for '" + odes_[i].var + "' at t=" +
                   std::to_string(at) + " during " + stage + " stage";
        }
        return false;
      }
    }
    return true;
  };
  std::vector<double> k1, k2, k3, k4, stage(count);
  if (!derivatives(input, t, k1, "k1")) return false;
  for (std::size_t i = 0; i < count; ++i) stage[i] = input[i] + 0.5 * h * k1[i];
  if (!derivatives(stage, t + 0.5 * h, k2, "k2")) return false;
  for (std::size_t i = 0; i < count; ++i) stage[i] = input[i] + 0.5 * h * k2[i];
  if (!derivatives(stage, t + 0.5 * h, k3, "k3")) return false;
  for (std::size_t i = 0; i < count; ++i) stage[i] = input[i] + h * k3[i];
  if (!derivatives(stage, t + h, k4, "k4")) return false;
  output.resize(count);
  for (std::size_t i = 0; i < count; ++i) {
    output[i] = input[i] + (h / 6.0) *
                                  (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    if (!std::isfinite(output[i])) {
      if (error != nullptr) {
        *error = "non-finite RK4 result for '" + odes_[i].var + "' at t=" +
                 std::to_string(t + h);
      }
      return false;
    }
  }
  return true;
}

void ContinuousReplicationModel::record_zero_crossings(
    const std::vector<double>& before, const std::vector<double>& after,
    double start_time, double step_seconds) {
  if (!detect_zero_crossings_ || before.size() != after.size() ||
      zero_crossings_.size() >= kMaxZeroCrossings) {
    return;
  }
  for (std::size_t i = 0; i < before.size() && zero_crossings_.size() < kMaxZeroCrossings;
       ++i) {
    const double left = before[i];
    const double right = after[i];
    const bool upward = left < 0.0 && right >= 0.0;
    const bool downward = left > 0.0 && right <= 0.0;
    if (!upward && !downward) continue;
    const double denominator = std::abs(left) + std::abs(right);
    const double fraction = denominator == 0.0 ? 0.5 : std::abs(left) / denominator;
    ContinuousZeroCrossing crossing;
    crossing.variable = odes_[i].var;
    crossing.at = start_time + step_seconds * std::clamp(fraction, 0.0, 1.0);
    crossing.before = left;
    crossing.after = right;
    crossing.direction = upward ? ZeroCrossingDirection::kUpward
                                : ZeroCrossingDirection::kDownward;
    zero_crossings_.push_back(std::move(crossing));
    if (zero_crossing_observer_) zero_crossing_observer_(zero_crossings_.back());
  }
}

bool ContinuousReplicationModel::adaptive_step() {
  if (done()) return false;
  if (stop_at_zero_crossings_ && prepared_step_ <= 0.0 && !prepare_next_step()) {
    return false;
  }
  const bool was_prepared = prepared_step_ > 0.0;
  if (was_prepared) {
    // The shared scheduler timestamp was generated from this exact step.
    // Re-evaluate once for the accepted refined result; state is unchanged
    // since preflight, so the error must be within the same bound.
    const double h = prepared_step_;
    prepared_step_ = 0.0;
    std::vector<double> full, half, refined;
    std::string trial_error;
    if (!rk4_trial(y_, current_t_, h, full, &trial_error) ||
        !rk4_trial(y_, current_t_, h * 0.5, half, &trial_error) ||
        !rk4_trial(half, current_t_ + h * 0.5, h * 0.5, refined, &trial_error)) {
      error_ = trial_error.empty() ? "adaptive RK4 prepared trial failed" : trial_error;
      active_ = false;
      return false;
    }
    double normalized_error = 0.0;
    for (std::size_t i = 0; i < y_.size(); ++i) {
      const double scale = absolute_tolerance_ +
                           relative_tolerance_ * std::max(std::abs(y_[i]),
                                                           std::abs(refined[i]));
      normalized_error = std::max(normalized_error,
                                  std::abs(refined[i] - full[i]) / scale);
    }
    if (normalized_error > 1.0 && h > minimum_step_ * (1.0 + 1e-12)) {
      error_ = "adaptive RK4 preflight result changed before dispatch";
      active_ = false;
      return false;
    }
    const std::vector<double> previous = y_;
    y_ = std::move(refined);
    current_t_ += h;
    ++step_index_;
    last_step_seconds_ = h;
    max_local_error_ = std::max(max_local_error_, normalized_error);
    for (std::size_t i = 0; i < y_.size(); ++i) {
      state_[odes_[i].var] = y_[i];
      last_state_[odes_[i].var] = y_[i];
    }
    record_zero_crossings(previous, y_, current_t_ - h, h);
    TrajectoryPoint point;
    point.t = current_t_;
    point.values.assign(y_.begin(), y_.end());
    trajectory_.push_back(std::move(point));
    record_accepted_step_trace();
    const double factor = normalized_error == 0.0
                              ? 2.0
                              : 0.9 * std::pow(normalized_error, -0.2);
    proposed_step_ = std::min(maximum_step_,
                              std::max(minimum_step_, h * std::clamp(factor, 0.2, 5.0)));
    return true;
  }
  double h = std::min(proposed_step_, target_horizon_ - current_t_);
  if (!(h > 0.0) || !std::isfinite(h)) {
    active_ = false;
    return false;
  }
  for (int attempt = 0; attempt < 64; ++attempt) {
    std::vector<double> full, half, refined;
    std::string trial_error;
    if (!rk4_trial(y_, current_t_, h, full, &trial_error) ||
        !rk4_trial(y_, current_t_, h * 0.5, half, &trial_error) ||
        !rk4_trial(half, current_t_ + h * 0.5, h * 0.5, refined, &trial_error)) {
      error_ = trial_error.empty() ? "adaptive RK4 trial failed" : trial_error;
      active_ = false;
      return false;
    }
    double normalized_error = 0.0;
    for (std::size_t i = 0; i < y_.size(); ++i) {
      const double scale = absolute_tolerance_ +
                           relative_tolerance_ * std::max(std::abs(y_[i]),
                                                           std::abs(refined[i]));
      normalized_error = std::max(normalized_error,
                                  std::abs(refined[i] - full[i]) / scale);
    }
    if (normalized_error <= 1.0 || h <= minimum_step_ * (1.0 + 1e-12)) {
      const std::vector<double> previous = y_;
      y_ = std::move(refined);
      current_t_ += h;
      ++step_index_;
      last_step_seconds_ = h;
      max_local_error_ = std::max(max_local_error_, normalized_error);
      for (std::size_t i = 0; i < y_.size(); ++i) {
        state_[odes_[i].var] = y_[i];
        last_state_[odes_[i].var] = y_[i];
      }
      record_zero_crossings(previous, y_, current_t_ - h, h);
      TrajectoryPoint point;
      point.t = current_t_;
      point.values.assign(y_.begin(), y_.end());
      trajectory_.push_back(std::move(point));
      record_accepted_step_trace();
      const double factor = normalized_error == 0.0
                                ? 2.0
                                : 0.9 * std::pow(normalized_error, -0.2);
      proposed_step_ = std::min(maximum_step_,
                                std::max(minimum_step_, h *
                                                           std::clamp(factor, 0.2, 5.0)));
      return true;
    }
    const double factor = 0.9 * std::pow(normalized_error, -0.2);
    h *= std::clamp(factor, 0.1, 0.5);
    if (h < minimum_step_) {
      error_ = "adaptive RK4 minimum step reached at t=" + std::to_string(current_t_);
      active_ = false;
      return false;
    }
  }
  error_ = "adaptive RK4 exceeded retry budget at t=" + std::to_string(current_t_);
  active_ = false;
  return false;
}

bool ContinuousReplicationModel::step() {
  if (done()) {
    if (active_ && step_index_ >= step_budget_ &&
        step_budget_ < requested_step_budget_) {
      budget_exhausted_ = true;
      error_ = "KR1017: shared integration step budget exhausted (" +
               std::to_string(step_budget_) + " steps)";
      active_ = false;
    }
    return false;
  }
  if (adaptive_) return adaptive_step();
  constexpr double kDt =
      static_cast<double>(ContinuousReplicationModel::kStepNs) * 1e-9;
  const auto lookup = [&](const std::string& name) -> double {
    if (name == "t")
      return current_t_;
    const auto param = params_.find(name);
    if (param != params_.end())
      return param->second;
    const auto var = state_.find(name);
    return var != state_.end() ? var->second : 0.0;
  };

  const std::size_t count = odes_.size();
  current_t_ = static_cast<double>(step_index_) * kDt;
  std::vector<double> k1(count), k2(count), k3(count), k4(count);
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i];
  }
  const auto check_state = [&](const char* stage) {
    for (std::size_t i = 0; i < count; ++i) {
      const double value = state_[odes_[i].var];
      if (!std::isfinite(value)) {
        error_ = "non-finite RK4 state for '" + odes_[i].var + "' at t=" +
                 std::to_string(current_t_) + " during " + stage +
                 " stage: " + std::to_string(value);
        active_ = false;
        return false;
      }
    }
    return true;
  };
  const auto evaluate_derivatives = [&](std::vector<double>& derivatives,
                                        const char* stage) {
    for (std::size_t i = 0; i < count; ++i) {
      derivatives[i] = evaluators_[i].eval(lookup);
      if (!std::isfinite(derivatives[i])) {
        error_ = "non-finite derivative for '" + odes_[i].var + "' at t=" +
                 std::to_string(current_t_) + " during " + stage +
                 " stage: " + std::to_string(derivatives[i]);
        active_ = false;
        return false;
      }
    }
    return true;
  };
  if (!check_state("initial")) return false;
  if (!evaluate_derivatives(k1, "k1")) return false;
  current_t_ = (static_cast<double>(step_index_) + 0.5) * kDt;
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + 0.5 * kDt * k1[i];
  }
  if (!check_state("k2 state")) return false;
  if (!evaluate_derivatives(k2, "k2")) return false;
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + 0.5 * kDt * k2[i];
  }
  if (!check_state("k3 state")) return false;
  if (!evaluate_derivatives(k3, "k3")) return false;
  current_t_ = (static_cast<double>(step_index_) + 1.0) * kDt;
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + kDt * k3[i];
  }
  if (!check_state("k4 state")) return false;
  if (!evaluate_derivatives(k4, "k4")) return false;
  for (std::size_t i = 0; i < count; ++i) {
    const double next = y_[i] + (kDt / 6.0) *
                                      (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    if (!std::isfinite(next)) {
      error_ = "non-finite RK4 result for '" + odes_[i].var + "' at t=" +
               std::to_string(current_t_) + ": " + std::to_string(next);
      active_ = false;
      return false;
    }
      const double previous = y_[i];
      y_[i] = next;
      state_[odes_[i].var] = y_[i];
      last_state_[odes_[i].var] = y_[i];
      if (detect_zero_crossings_ && zero_crossings_.size() < kMaxZeroCrossings &&
          (previous < 0.0 && y_[i] >= 0.0 || previous > 0.0 && y_[i] <= 0.0)) {
        const double denominator = std::abs(previous) + std::abs(y_[i]);
        const double fraction = denominator == 0.0 ? 0.5 : std::abs(previous) / denominator;
        zero_crossings_.push_back(ContinuousZeroCrossing{
            odes_[i].var, current_t_ - kDt + kDt * std::clamp(fraction, 0.0, 1.0),
            previous, y_[i], previous < 0.0 ? ZeroCrossingDirection::kUpward
                                            : ZeroCrossingDirection::kDownward});
        if (zero_crossing_observer_) zero_crossing_observer_(zero_crossings_.back());
      }
  }
  ++step_index_;
  TrajectoryPoint point;
  point.t = static_cast<double>(step_index_) * kDt;
  point.values.assign(y_.begin(), y_.end());
  trajectory_.push_back(std::move(point));
  record_accepted_step_trace();
  return true;
}

void ContinuousReplicationModel::record_accepted_step_trace() {
  if (trace_ == nullptr) return;
  trace_->record_logical_step(
      SimTime::from_ns(static_cast<std::int64_t>(std::llround(current_t_ * 1e9))),
      kContinuousLogicalStep, step_index_);
}

bool ContinuousReplicationModel::done() const {
  if (!active_) return true;
  if (adaptive_) {
    return current_t_ + std::numeric_limits<double>::epsilon() *
                            std::max(1.0, target_horizon_) >= target_horizon_ ||
           step_index_ >= maximum_step_count_;
  }
  return step_index_ >= step_budget_;
}

ReplicationMetrics ContinuousReplicationModel::finish(TraceRecorder* trace) {
  ReplicationMetrics metrics;
  if (!active_ || !error_.empty() || odes_.empty())
    return metrics;
  constexpr double kDt =
      static_cast<double>(ContinuousReplicationModel::kStepNs) * 1e-9;
  metrics.arrivals = step_index_;
  const std::int64_t horizon_ns =
      static_cast<std::int64_t>(std::llround(current_t_ * 1e9));
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  metrics.final_value = last_state_[odes_.front().var];
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(horizon_ns));
    trace->absorb(static_cast<std::uint64_t>(last_state_[odes_.front().var] * 1e9));
  }
  active_ = false;
  return metrics;
}

}  // namespace logicpilot
