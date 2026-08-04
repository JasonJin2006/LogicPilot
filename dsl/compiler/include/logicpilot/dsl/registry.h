// Block-shape registry (library meta-layer, docs/specs/dsl-v2.md).
//
// Block shapes are declared in DSL library files (libraries/*.lplib) and
// loaded into this registry; the compiler validates model block instances
// against the registered shapes (required params, types, duplicates) and
// resolves `kind` against the registry. Block *semantics* stay in the
// compiler/runtime keyed by {library, block} (AnyLogic palette idea).
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::dsl {

enum class BlockParamType {
  kInt,
  kFloat,
  kBool,
  kString,
  kDistribution,
  kRef,
  kUnknown,
};

[[nodiscard]] BlockParamType block_param_type(const std::string& type_name);
[[nodiscard]] const char* block_param_type_name(BlockParamType type);

struct BlockParamSpec {
  std::string name;
  BlockParamType type{BlockParamType::kUnknown};
  bool required{false};  // no default in the library declaration
};

struct BlockShape {
  std::string kind;
  std::vector<BlockParamSpec> params;

  [[nodiscard]] const BlockParamSpec* param(
      const std::string& name) const {
    for (const BlockParamSpec& spec : params) {
      if (spec.name == name) {
        return &spec;
      }
    }
    return nullptr;
  }
};

// Registry loaded from DSL `library` declarations.
class LibraryRegistry {
 public:
  // Parse a library source into shapes. Returns false (and fills
  // `diagnostics` when non-null) if the source does not parse.
  [[nodiscard]] bool load(const std::string& source,
                          std::vector<Diagnostic>* diagnostics);

  [[nodiscard]] bool has_block(const std::string& kind) const {
    return index_.count(kind) > 0;
  }

  [[nodiscard]] const BlockShape* block(const std::string& kind) const {
    const auto it = index_.find(kind);
    return it == index_.end() ? nullptr : &blocks_[it->second];
  }

  [[nodiscard]] const std::vector<BlockShape>& blocks() const {
    return blocks_;
  }

 private:
  std::unordered_map<std::string, std::size_t> index_;
  std::vector<BlockShape> blocks_;
};

// The embedded standard process library (libraries/process.lplib).
[[nodiscard]] const LibraryRegistry& builtin_process_registry();

}  // namespace logicpilot::dsl
