// DEVS-lite CoupledModel - child models + port coupling table.
//
// Pure description: owns the child tree and coupling specs (string names,
// resolved to port ids by the executor at load time). Children are either
// AtomicModel or nested CoupledModel, so coupling trees nest arbitrarily
// deep; the executor flattens everything to atomic-level routing.
#pragma once

#include <memory>
#include <string>
#include <vector>

#include "logicpilot/devs/atomic_model.h"

namespace logicpilot {

// One directed coupling. "." as a model name denotes the enclosing model
// itself (parent-port pass-through), mirroring schemas/ir.fbs Coupling.
struct CouplingSpec {
  std::string from_model;
  std::string from_port;
  std::string to_model;
  std::string to_port;
};

class CoupledModel {
 public:
  struct Child {
    std::string name;
    std::unique_ptr<AtomicModel> atomic;      // exactly one of
    std::unique_ptr<CoupledModel> coupled;    // these two is non-null

    [[nodiscard]] bool is_atomic() const { return atomic != nullptr; }
  };

  explicit CoupledModel(std::string name = "") : name_{std::move(name)} {}

  CoupledModel(const CoupledModel&) = delete;
  CoupledModel& operator=(const CoupledModel&) = delete;

  [[nodiscard]] const std::string& name() const { return name_; }

  std::size_t add_atomic(std::string child_name,
                         std::unique_ptr<AtomicModel> model) {
    children_.push_back(
        Child{std::move(child_name), std::move(model), nullptr});
    return children_.size() - 1;
  }

  std::size_t add_coupled(std::string child_name,
                          std::unique_ptr<CoupledModel> model) {
    children_.push_back(
        Child{std::move(child_name), nullptr, std::move(model)});
    return children_.size() - 1;
  }

  void couple(std::string from_model, std::string from_port,
              std::string to_model, std::string to_port) {
    couplings_.push_back(CouplingSpec{std::move(from_model),
                                      std::move(from_port),
                                      std::move(to_model), std::move(to_port)});
  }

  [[nodiscard]] const std::vector<Child>& children() const {
    return children_;
  }
  [[nodiscard]] const std::vector<CouplingSpec>& couplings() const {
    return couplings_;
  }
  [[nodiscard]] const Child* find_child(const std::string& child_name) const {
    for (const Child& c : children_) {
      if (c.name == child_name) {
        return &c;
      }
    }
    return nullptr;
  }

 private:
  std::string name_;
  std::vector<Child> children_;
  std::vector<CouplingSpec> couplings_;
};

}  // namespace logicpilot
