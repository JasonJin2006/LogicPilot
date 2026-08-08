// Continuous ODE engine (see continuous.h).
#include "logicpilot/devs/continuous.h"

#include <cctype>
#include <cmath>
#include <cstring>
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

}  // namespace

// ---------------------------------------------------------------------------
// ExpressionEvaluator
// ---------------------------------------------------------------------------

ExpressionEvaluator::ExpressionEvaluator(std::string text) : text_{std::move(text)} {
  parse();
}

void ExpressionEvaluator::parse() {
  root_ = parse_cmp();
  while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
    ++pos_;
  }
  if (pos_ < text_.size()) {
    error_ = "unexpected trailing input at '" + text_.substr(pos_) + "'";
    root_.reset();
  }
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_cmp() {
  auto left = parse_expr();
  if (left == nullptr) {
    return nullptr;
  }
  for (;;) {
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
    Node::Kind kind = Node::Kind::kNumber;
    if (pos_ + 1 < text_.size() && text_[pos_] == '<' && text_[pos_ + 1] == '=') {
      kind = Node::Kind::kLe;
      pos_ += 2;
    } else if (pos_ + 1 < text_.size() && text_[pos_] == '>' && text_[pos_ + 1] == '=') {
      kind = Node::Kind::kGe;
      pos_ += 2;
    } else if (pos_ + 1 < text_.size() && text_[pos_] == '=' && text_[pos_ + 1] == '=') {
      kind = Node::Kind::kEq;
      pos_ += 2;
    } else if (pos_ + 1 < text_.size() && text_[pos_] == '!' && text_[pos_ + 1] == '=') {
      kind = Node::Kind::kNe;
      pos_ += 2;
    } else if (pos_ < text_.size() && text_[pos_] == '<') {
      kind = Node::Kind::kLt;
      ++pos_;
    } else if (pos_ < text_.size() && text_[pos_] == '>') {
      kind = Node::Kind::kGt;
      ++pos_;
    } else {
      break;
    }
    auto right = parse_expr();
    if (right == nullptr) {
      return nullptr;
    }
    auto node = std::make_unique<Node>();
    node->kind = kind;
    node->left = std::move(left);
    node->right = std::move(right);
    left = std::move(node);
  }
  return left;
}

std::unique_ptr<ExpressionEvaluator::Node> ExpressionEvaluator::parse_expr() {
  auto left = parse_term();
  if (left == nullptr) {
    return nullptr;
  }
  for (;;) {
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
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
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
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
  while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
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
  while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
    ++pos_;
  }
  if (pos_ >= text_.size()) {
    error_ = "unexpected end of expression";
    return nullptr;
  }
  const char c = text_[pos_];
  if (c == '(') {
    ++pos_;
    auto inner = parse_cmp();
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
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
        if (end < text_.size() && (text_[end] == '+' || text_[end] == '-')) {
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
           (std::isalnum(static_cast<unsigned char>(text_[end])) || text_[end] == '_')) {
      ++end;
    }
    std::string identifier = text_.substr(pos_, end - pos_);
    pos_ = end;
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
      ++pos_;
    }
    if (pos_ < text_.size() && text_[pos_] == '(') {
      ++pos_;
      auto inner = parse_expr();
      if (inner == nullptr) {
        return nullptr;
      }
      while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) {
        ++pos_;
      }
      if (pos_ >= text_.size() || text_[pos_] != ')') {
        error_ = "missing ')' in function call";
        return nullptr;
      }
      ++pos_;
      auto node = std::make_unique<Node>();
      node->kind = Node::Kind::kFunc;
      node->func = std::move(identifier);
      node->left = std::move(inner);
      return node;
    }
    auto node = std::make_unique<Node>();
    node->kind = Node::Kind::kIdent;
    node->ident = std::move(identifier);
    return node;
  }
  error_ = std::string("unexpected character '") + c + "'";
  return nullptr;
}

double ExpressionEvaluator::eval(const std::function<double(const std::string&)>& lookup) const {
  if (root_ == nullptr) {
    return 0.0;
  }
  return eval_node(root_.get(), lookup);
}

double ExpressionEvaluator::eval_node(const Node* node,
                                      const std::function<double(const std::string&)>& lookup) {
  using Kind = Node::Kind;
  switch (node->kind) {
    case Kind::kNumber:
      return node->number;
    case Kind::kIdent:
      return lookup(node->ident);
    case Kind::kFunc: {
      const double arg = eval_node(node->left.get(), lookup);
      if (node->func == "exp") {
        return std::exp(arg);
      }
      if (node->func == "log") {
        return std::log(arg);
      }
      if (node->func == "sqrt") {
        return std::sqrt(arg);
      }
      if (node->func == "sin") {
        return std::sin(arg);
      }
      if (node->func == "cos") {
        return std::cos(arg);
      }
      return 0.0;
    }
    case Kind::kAdd:
      return eval_node(node->left.get(), lookup) + eval_node(node->right.get(), lookup);
    case Kind::kSub:
      return eval_node(node->left.get(), lookup) - eval_node(node->right.get(), lookup);
    case Kind::kMul:
      return eval_node(node->left.get(), lookup) * eval_node(node->right.get(), lookup);
    case Kind::kDiv:
      return eval_node(node->left.get(), lookup) / eval_node(node->right.get(), lookup);
    case Kind::kNeg:
      return -eval_node(node->left.get(), lookup);
    case Kind::kLt:
      return eval_node(node->left.get(), lookup) < eval_node(node->right.get(), lookup) ? 1.0 : 0.0;
    case Kind::kGt:
      return eval_node(node->left.get(), lookup) > eval_node(node->right.get(), lookup) ? 1.0 : 0.0;
    case Kind::kLe:
      return eval_node(node->left.get(), lookup) <= eval_node(node->right.get(), lookup) ? 1.0
                                                                                         : 0.0;
    case Kind::kGe:
      return eval_node(node->left.get(), lookup) >= eval_node(node->right.get(), lookup) ? 1.0
                                                                                         : 0.0;
    case Kind::kEq:
      return eval_node(node->left.get(), lookup) == eval_node(node->right.get(), lookup) ? 1.0
                                                                                         : 0.0;
    case Kind::kNe:
      return eval_node(node->left.get(), lookup) != eval_node(node->right.get(), lookup) ? 1.0
                                                                                         : 0.0;
  }
  return 0.0;
}

// ---------------------------------------------------------------------------
// ContinuousReplicationModel
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
  if (!reset(config))
    return ReplicationMetrics{};
  while (step()) {
  }
  return finish(trace);
}

bool ContinuousReplicationModel::reset(const ReplicationConfig& config) {
  state_.clear();
  evaluators_.clear();
  y_.clear();
  variables_.clear();
  trajectory_.clear();
  last_state_.clear();
  active_ = false;
  if (odes_.empty())
    return false;

  for (const Ode& ode : odes_) {
    state_[ode.var] = ode.initial;
    ExpressionEvaluator evaluator{ode.rhs_text};
    if (!evaluator.ok())
      return false;
    evaluators_.push_back(std::move(evaluator));
    variables_.push_back(ode.var);
    y_.push_back(ode.initial);
    last_state_[ode.var] = ode.initial;
  }
  step_budget_ = config.arrivals;
  step_index_ = 0;
  current_t_ = 0.0;
  trajectory_.reserve(static_cast<std::size_t>(step_budget_));
  active_ = true;
  return true;
}

bool ContinuousReplicationModel::step() {
  if (done())
    return false;
  constexpr double kDt = 0.01;
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
  for (std::size_t i = 0; i < count; ++i) {
    k1[i] = evaluators_[i].eval(lookup);
  }
  current_t_ = (static_cast<double>(step_index_) + 0.5) * kDt;
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + 0.5 * kDt * k1[i];
  }
  for (std::size_t i = 0; i < count; ++i) {
    k2[i] = evaluators_[i].eval(lookup);
  }
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + 0.5 * kDt * k2[i];
  }
  for (std::size_t i = 0; i < count; ++i) {
    k3[i] = evaluators_[i].eval(lookup);
  }
  current_t_ = (static_cast<double>(step_index_) + 1.0) * kDt;
  for (std::size_t i = 0; i < count; ++i) {
    state_[odes_[i].var] = y_[i] + kDt * k3[i];
  }
  for (std::size_t i = 0; i < count; ++i) {
    k4[i] = evaluators_[i].eval(lookup);
  }
  for (std::size_t i = 0; i < count; ++i) {
    y_[i] += (kDt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    state_[odes_[i].var] = y_[i];
    last_state_[odes_[i].var] = y_[i];
  }
  ++step_index_;
  TrajectoryPoint point;
  point.t = static_cast<double>(step_index_) * kDt;
  point.values.assign(y_.begin(), y_.end());
  trajectory_.push_back(std::move(point));
  return true;
}

bool ContinuousReplicationModel::done() const {
  return !active_ || step_index_ >= step_budget_;
}

ReplicationMetrics ContinuousReplicationModel::finish(TraceRecorder* trace) {
  ReplicationMetrics metrics;
  if (!active_ || odes_.empty())
    return metrics;
  constexpr double kDt = 0.01;
  metrics.arrivals = step_index_;
  const std::int64_t horizon_ns =
      static_cast<std::int64_t>(static_cast<double>(step_index_) * kDt * 1e9);
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
