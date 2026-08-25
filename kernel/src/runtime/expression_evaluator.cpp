// Neutral expression engine (ADR-0068 rehoming): shared by the process,
// statechart and continuous runtimes. Declared in logicpilot/devs/continuous.h
// until that header is split; implementation belongs to the core target.
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

}  // namespace logicpilot
