// Continuous ODE engine (see continuous.h).
#include "logicpilot/devs/continuous.h"

#include <cctype>
#include <cstring>
#include <utility>

#include "ir_generated.h"
#include "ir_v2_generated.h"

namespace logicpilot {
namespace {

namespace v2 = logicpilot::ir::v2;

}  // namespace

// ---------------------------------------------------------------------------
// ExpressionEvaluator
// ---------------------------------------------------------------------------

ExpressionEvaluator::ExpressionEvaluator(std::string text)
    : text_{std::move(text)} {
  parse();
}

void ExpressionEvaluator::parse() {
  root_ = parse_expr();
  while (pos_ < text_.size() &&
         std::isspace(static_cast<unsigned char>(text_[pos_]))) {
    ++pos_;
  }
  if (pos_ < text_.size()) {
    error_ = "unexpected trailing input at '" + text_.substr(pos_) + "'";
    root_.reset();
  }
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_expr() {
  auto left = parse_term();
  if (left == nullptr) {
    return nullptr;
  }
  for (;;) {
    while (pos_ < text_.size() &&
           std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
    if (pos_ < text_.size() && (text_[pos_] == '+' || text_[pos_] == '-')) {
      const char op = text_[pos_++];
      auto right = parse_term();
      if (right == nullptr) {
        return nullptr;
      }
      auto node = std::make_unique<Node>();
      node->kind = op == '+' ? Node::Kind::kAdd : Node::Kind::kSub;
      node->left = std::move(left);
      node->right = std::move(right);
      left = std::move(node);
    } else {
      break;
    }
  }
  return left;
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_term() {
  auto left = parse_factor();
  if (left == nullptr) {
    return nullptr;
  }
  for (;;) {
    while (pos_ < text_.size() &&
           std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
    if (pos_ < text_.size() && (text_[pos_] == '*' || text_[pos_] == '/')) {
      const char op = text_[pos_++];
      auto right = parse_factor();
      if (right == nullptr) {
        return nullptr;
      }
      auto node = std::make_unique<Node>();
      node->kind = op == '*' ? Node::Kind::kMul : Node::Kind::kDiv;
      node->left = std::move(left);
      node->right = std::move(right);
      left = std::move(node);
    } else {
      break;
    }
  }
  return left;
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_factor() {
  while (pos_ < text_.size() &&
         std::isspace(static_cast<unsigned char>(text_[pos_]))) {
    ++pos_;
  }
  if (pos_ < text_.size() && text_[pos_] == '-') {
    ++pos_;
    auto inner = parse_factor();
    auto node = std::make_unique<Node>();
    node->kind = Node::Kind::kNeg;
    node->left = std::move(inner);
    return node;
  }
  return parse_primary();
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_primary() {
  while (pos_ < text_.size() &&
         std::isspace(static_cast<unsigned char>(text_[pos_]))) {
    ++pos_;
  }
  if (pos_ >= text_.size()) {
    error_ = "unexpected end of expression";
    return nullptr;
  }
  const char c = text_[pos_];
  if (c == '(') {
    ++pos_;
    auto inner = parse_expr();
    while (pos_ < text_.size() &&
           std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
    if (pos_ < text_.size() && text_[pos_] == ')') {
      ++pos_;
      return inner;
    }
    error_ = "missing ')'";
    return nullptr;
  }
  if (std::isdigit(static_cast<unsigned char>(c)) || c == '.') {
    std::size_t end = pos_;
    while (end < text_.size()) {
      const char ch = text_[end];
      if (std::isdigit(static_cast<unsigned char>(ch)) || ch == '.') {
        ++end;
      } else if (ch == 'e' || ch == 'E') {
        ++end;
        if (end < text_.size() &&
            (text_[end] == '+' || text_[end] == '-')) {
          ++end;
        }
      } else {
        break;
      }
    }
    auto node = std::make_unique<Node>();
    node->kind = Node::Kind::kNumber;
    node->number = std::strtod(text_.c_str() + pos_, nullptr);
    pos_ = end;
    return node;
  }
  if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
    std::size_t end = pos_;
    while (end < text_.size() &&
           (std::isalnum(static_cast<unsigned char>(text_[end])) ||
            text_[end] == '_')) {
      ++end;
    }
    auto node = std::make_unique<Node>();
    node->kind = Node::Kind::kIdent;
    node->ident = text_.substr(pos_, end - pos_);
    pos_ = end;
    return node;
  }
  error_ = std::string("unexpected character '") + c + "'";
  return nullptr;
}

double ExpressionEvaluator::eval(
    const std::function<double(const std::string&)>& lookup) const {
  if (root_ == nullptr) {
    return 0.0;
  }
  return eval_node(root_.get(), lookup);
}

double ExpressionEvaluator::eval_node(
    const Node* node,
    const std::function<double(const std::string&)>& lookup) {
  using Kind = Node::Kind;
  switch (node->kind) {
    case Kind::kNumber:
      return node->number;
    case Kind::kIdent:
      return lookup(node->ident);
    case Kind::kAdd:
      return eval_node(node->left.get(), lookup) +
             eval_node(node->right.get(), lookup);
    case Kind::kSub:
      return eval_node(node->left.get(), lookup) -
             eval_node(node->right.get(), lookup);
    case Kind::kMul:
      return eval_node(node->left.get(), lookup) *
             eval_node(node->right.get(), lookup);
    case Kind::kDiv:
      return eval_node(node->left.get(), lookup) /
             eval_node(node->right.get(), lookup);
    case Kind::kNeg:
      return -eval_node(node->left.get(), lookup);
  }
  return 0.0;
}

// ---------------------------------------------------------------------------
// ContinuousReplicationModel
// ---------------------------------------------------------------------------

ContinuousReplicationModel::ContinuousReplicationModel(
    std::vector<std::uint8_t> v2_bytes, const v2::Node* v2_root)
    : bytes_{std::move(v2_bytes)}, v2_root_{v2_root}, v2_native_{true} {
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

ContinuousReplicationModel::ContinuousReplicationModel(
    std::vector<std::uint8_t> bytes, const ir::EquationModel* root)
    : bytes_{std::move(bytes)}, v1_root_{root} {
  if (v1_root_ != nullptr) {
    if (v1_root_->params() != nullptr) {
      for (const ir::Param* param : *v1_root_->params()) {
        if (param->name() != nullptr &&
            param->value_type() == ir::ParamValue_FloatValue) {
          params_[param->name()->str()] =
              param->value_as_FloatValue()->value();
        }
      }
    }
    if (v1_root_->variables() != nullptr) {
      for (const ir::EquationVariable* variable : *v1_root_->variables()) {
        if (variable->name() == nullptr) {
          continue;
        }
        Ode ode;
        ode.var = variable->name()->str();
        ode.initial = variable->initial_value();
        odes_.push_back(std::move(ode));
      }
    }
    if (v1_root_->equations() != nullptr) {
      for (flatbuffers::uoffset_t i = 0; i < v1_root_->equations()->size();
           ++i) {
        if (i < odes_.size()) {
          odes_[i].rhs_text = v1_root_->equations()->Get(i)->str();
        }
      }
    }
  }
}

ReplicationMetrics ContinuousReplicationModel::run(
    const ReplicationConfig& config, TraceRecorder* trace) {
  ReplicationMetrics metrics;
  metrics.arrivals = 0;

  constexpr double kDt = 0.01;
  std::unordered_map<std::string, double> state;
  std::vector<ExpressionEvaluator> evaluators;
  bool valid = !odes_.empty();
  for (const Ode& ode : odes_) {
    state[ode.var] = ode.initial;
    ExpressionEvaluator evaluator{ode.rhs_text};
    if (!evaluator.ok()) {
      valid = false;
      break;
    }
    evaluators.push_back(std::move(evaluator));
  }
  if (!valid) {
    return metrics;
  }

  const std::uint64_t steps = config.arrivals;
  const auto lookup = [&](const std::string& name) -> double {
    const auto param = params_.find(name);
    if (param != params_.end()) {
      return param->second;
    }
    const auto var = state.find(name);
    return var != state.end() ? var->second : 0.0;
  };

  const std::size_t count = odes_.size();
  std::vector<double> y(count);
  for (std::size_t i = 0; i < count; ++i) {
    y[i] = state[odes_[i].var];
  }
  for (std::uint64_t step = 0; step < steps; ++step) {
    std::vector<double> k1(count), k2(count), k3(count), k4(count);
    for (std::size_t i = 0; i < count; ++i) {
      state[odes_[i].var] = y[i];
    }
    for (std::size_t i = 0; i < count; ++i) {
      k1[i] = evaluators[i].eval(lookup);
    }
    for (std::size_t i = 0; i < count; ++i) {
      state[odes_[i].var] = y[i] + 0.5 * kDt * k1[i];
    }
    for (std::size_t i = 0; i < count; ++i) {
      k2[i] = evaluators[i].eval(lookup);
    }
    for (std::size_t i = 0; i < count; ++i) {
      state[odes_[i].var] = y[i] + 0.5 * kDt * k2[i];
    }
    for (std::size_t i = 0; i < count; ++i) {
      k3[i] = evaluators[i].eval(lookup);
    }
    for (std::size_t i = 0; i < count; ++i) {
      state[odes_[i].var] = y[i] + kDt * k3[i];
    }
    for (std::size_t i = 0; i < count; ++i) {
      k4[i] = evaluators[i].eval(lookup);
    }
    for (std::size_t i = 0; i < count; ++i) {
      y[i] += (kDt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
  }
  for (std::size_t i = 0; i < count; ++i) {
    last_state_[odes_[i].var] = y[i];
  }

  metrics.arrivals = steps;
  const std::int64_t horizon_ns =
      static_cast<std::int64_t>(static_cast<double>(steps) * kDt * 1e9);
  metrics.horizon_seconds = static_cast<double>(horizon_ns) * 1e-9;
  metrics.final_value = last_state_[odes_.front().var];
  if (trace != nullptr) {
    trace->absorb(static_cast<std::uint64_t>(horizon_ns));
    trace->absorb(static_cast<std::uint64_t>(
        last_state_[odes_.front().var] * 1e9));
  }
  return metrics;
}

}  // namespace logicpilot
