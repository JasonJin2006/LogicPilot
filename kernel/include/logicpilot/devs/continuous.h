// Continuous (ODE) engine - Phase D: structured equations execute via a
// fixed-step RK4 integrator. v0 RHS grammar: numbers, identifiers (node
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
// ReplicationConfig.arrivals is the number of integration steps (dt = 0.01).
#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
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
  double eval(
      const std::function<double(const std::string&)>& lookup) const;

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
  static double eval_node(
      const Node* node,
      const std::function<double(const std::string&)>& lookup);

  std::string text_;
  std::size_t pos_{0};
  std::string error_;
  std::unique_ptr<Node> root_;
};

class ContinuousReplicationModel final : public ReplicationModel {
 public:
  // v2-native: semantics {sd, equation} node.
  ContinuousReplicationModel(std::vector<std::uint8_t> v2_bytes,
                             const ir::v2::Node* v2_root);

  ReplicationMetrics run(const ReplicationConfig& config,
                         TraceRecorder* trace) override;

  // Final integrated state (test inspection).
  [[nodiscard]] std::unordered_map<std::string, double> last_state() const {
    return last_state_;
  }

  // Sampled trajectory (one point per integration step) for visualization.
  struct TrajectoryPoint {
    double t{0.0};
    std::vector<double> values;  // aligned with variables()
  };
  [[nodiscard]] const std::vector<std::string>& variables() const {
    return variables_;
  }
  [[nodiscard]] const std::vector<TrajectoryPoint>& trajectory() const {
    return trajectory_;
  }

 private:
  struct Ode {
    std::string var;
    std::string rhs_text;
    double initial{0.0};
  };

  std::vector<std::uint8_t> bytes_;
  const ir::v2::Node* v2_root_{nullptr};
  std::vector<Ode> odes_;
  std::unordered_map<std::string, double> params_;
  std::unordered_map<std::string, double> last_state_;
  std::vector<std::string> variables_;
  std::vector<TrajectoryPoint> trajectory_;
};

}  // namespace logicpilot
