// Continuous (ODE) engine - Phase D: structured equations execute via a
// fixed-step RK4 integrator, with an opt-in adaptive step-doubling mode.
// v0 RHS grammar: numbers, identifiers (node
// params + state variables), + - * / and parentheses, e.g. "-k*y" (exponential
// decay) or "r*y*(1-y/K)" (logistic). Functions: exp, log, sqrt, sin, cos;
// "t" is reserved for the current simulation time. Deterministic: no RNG.
//
// Consumes:
//   * v2-native: a Node with semantics {library:"sd", block:"equation"} whose
//     `continuous` equations carry {lhs, rhs_text, initial_value} and whose
//     params feed the RHS identifiers;
//   * v1 compatibility: an ir::EquationModel (variables -> initial values,
//     equations -> rhs_text).
// ReplicationConfig.arrivals is the number of fixed integration steps
// (dt = 0.01). A continuous node may opt into adaptive step-doubling RK4 by
// declaring numeric params `adaptive = 1`, `absolute_tolerance`,
// `relative_tolerance`, `minimum_step`, `maximum_step`, and optional `horizon`.
// `stop_at_zero_crossings = 1` additionally clips an adaptive step at the
// first detected zero crossing (requires `detect_zero_crossings = 1`).
#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <span>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "logicpilot/devs/replication.h"

namespace logicpilot {
namespace ir {
struct EquationModel;
}
namespace ir::v2 {
struct Node;
}

// Recursive-descent evaluator for the v0 RHS grammar.
class ExpressionEvaluator {
public:
  explicit ExpressionEvaluator(std::string text);

  [[nodiscard]] bool ok() const { return root_ != nullptr; }
  [[nodiscard]] std::string error() const { return error_; }
  double eval(const std::function<double(const std::string&)>& lookup) const;

private:
  struct Node {
    enum class Kind {
      kNumber,
      kIdent,
      kFunc,
      kAdd,
      kSub,
      kMul,
      kDiv,
      kNeg,
      kLt,
      kGt,
      kLe,
      kGe,
      kEq,
      kNe,
    };
    Kind kind{Kind::kNumber};
    double number{0.0};
    std::string ident;
    std::string func;
    std::unique_ptr<Node> left;
    std::unique_ptr<Node> right;
  };

  void parse();
  std::unique_ptr<Node> parse_cmp();
  std::unique_ptr<Node> parse_expr();
  std::unique_ptr<Node> parse_term();
  std::unique_ptr<Node> parse_factor();
  std::unique_ptr<Node> parse_primary();
  static double eval_node(const Node* node,
                          const std::function<double(const std::string&)>& lookup);

  std::string text_;
  std::size_t pos_{0};
  std::string error_;
  std::unique_ptr<Node> root_;
};

enum class ZeroCrossingDirection : std::uint8_t {
  kUpward,
  kDownward,
};

struct ContinuousZeroCrossing {
  std::string variable;
  double at{0.0};
  double before{0.0};
  double after{0.0};
  ZeroCrossingDirection direction{ZeroCrossingDirection::kUpward};
};

class ContinuousReplicationModel final : public ReplicationModel {
public:
  // Fixed RK4 integration interval used by the v2 continuous runtime.
  inline static constexpr std::int64_t kStepNs = 10'000'000;

  // v2-native: semantics {sd, equation} node.
  ContinuousReplicationModel(std::vector<std::uint8_t> v2_bytes, const ir::v2::Node* v2_root);

  ReplicationMetrics run(const ReplicationConfig& config, TraceRecorder* trace) override;

  bool reset(const ReplicationConfig& config);
  bool step();
  [[nodiscard]] bool checkpoint_save(
      std::vector<std::uint8_t>& state) const;
  bool checkpoint_restore(std::span<const std::uint8_t> state);
  [[nodiscard]] bool done() const;
  [[nodiscard]] bool failed() const {
    return budget_exhausted_ || !error_.empty();
  }
  [[nodiscard]] const std::string& last_error() const { return error_; }
  [[nodiscard]] std::uint64_t step_count() const { return step_index_; }
  [[nodiscard]] double sim_time_seconds() const { return current_t_; }
  // Delay until the next shared-scheduler integration event. Fixed-step
  // models return 0.01; adaptive models return their current proposed step.
  [[nodiscard]] double next_step_seconds() const;
  // Preflight the next adaptive step before a shared-scheduler event is
  // timestamped. This prevents a rejected trial from making continuous time
  // outrun the kernel clock.
  bool prepare_next_step();
  [[nodiscard]] bool adaptive_solver() const { return adaptive_; }
  [[nodiscard]] double max_local_error() const { return max_local_error_; }
  [[nodiscard]] const std::vector<ContinuousZeroCrossing>& zero_crossings() const {
    return zero_crossings_;
  }
  using ZeroCrossingObserver =
      std::function<void(const ContinuousZeroCrossing&)>;
  void set_zero_crossing_observer(ZeroCrossingObserver observer) {
    zero_crossing_observer_ = std::move(observer);
  }
  ReplicationMetrics finish(TraceRecorder* trace = nullptr);

  // Final integrated state (test inspection).
  [[nodiscard]] std::unordered_map<std::string, double> last_state() const { return last_state_; }

  // Sampled trajectory (one point per integration step) for visualization.
  struct TrajectoryPoint {
    double t{0.0};
    std::vector<double> values;  // aligned with variables()
  };
  [[nodiscard]] const std::vector<std::string>& variables() const { return variables_; }
  [[nodiscard]] const std::vector<TrajectoryPoint>& trajectory() const { return trajectory_; }

private:
  struct Ode {
    std::string var;
    std::string rhs_text;
    double initial{0.0};
  };

  bool adaptive_step();
  void record_accepted_step_trace();
  bool rk4_trial(const std::vector<double>& input, double t, double h,
                 std::vector<double>& output, std::string* error) const;
  void record_zero_crossings(const std::vector<double>& before,
                             const std::vector<double>& after,
                             double start_time, double step_seconds);

  std::vector<std::uint8_t> bytes_;
  const ir::v2::Node* v2_root_{nullptr};
  std::vector<Ode> odes_;
  std::unordered_map<std::string, double> params_;
  std::unordered_map<std::string, double> last_state_;
  std::vector<std::string> variables_;
  std::vector<TrajectoryPoint> trajectory_;
  std::vector<ExpressionEvaluator> evaluators_;
  std::unordered_map<std::string, double> state_;
  std::vector<double> y_;
  std::uint64_t step_budget_{0};
  std::uint64_t requested_step_budget_{0};
  std::uint64_t step_index_{0};
  double current_t_{0.0};
  bool adaptive_{false};
  double absolute_tolerance_{1e-9};
  double relative_tolerance_{1e-6};
  double minimum_step_{1e-12};
  double maximum_step_{0.01};
  double proposed_step_{0.01};
  double prepared_step_{0.0};
  double target_horizon_{0.0};
  std::uint64_t maximum_step_count_{0};
  double last_step_seconds_{0.0};
  double max_local_error_{0.0};
  bool detect_zero_crossings_{false};
  bool stop_at_zero_crossings_{false};
  std::vector<ContinuousZeroCrossing> zero_crossings_;
  ZeroCrossingObserver zero_crossing_observer_;
  bool active_{false};
  bool budget_exhausted_{false};
  std::string error_;
  TraceRecorder* trace_{nullptr};
};

}  // namespace logicpilot
