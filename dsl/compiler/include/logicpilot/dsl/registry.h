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
  kExpression,
  kUnknown,
};

[[nodiscard]] BlockParamType block_param_type(const std::string& type_name);
[[nodiscard]] const char* block_param_type_name(BlockParamType type);

struct BlockParamSpec {
  std::string name;
  BlockParamType type{BlockParamType::kUnknown};
  bool required{false};  // no default in the library declaration
};

// A block port declared in the library shape. `condition` is the name of a
// block field that must evaluate to true for the port to be usable ("" =
// unconditional). Ports are validated by the coupling checker.
struct BlockPortSpec {
  std::string name;
  std::string direction;  // "in" | "out" | "inout"
  std::string type;
  std::string condition;  // "" => unconditional
};

struct BlockShape {
  // Owning semantic namespace from `library <name> { ... }`. This is kept
  // all the way through lowering so a standalone third-party block becomes
  // `{library, block}` in IR instead of being silently treated as process.
  std::string library;
  std::int64_t library_version{1};
  std::string kind;
  // Custom library blocks may map onto a built-in kernel block (e.g.
  // `block Machine { extends: ref = service }`); "" = no mapping. The
  // effective shape and the lowering target come from resolve().
  std::string extends_kind;
  std::vector<BlockParamSpec> params;
  std::vector<BlockPortSpec> ports;

  [[nodiscard]] const BlockParamSpec* param(const std::string& name) const {
    for (const BlockParamSpec& spec : params) {
      if (spec.name == name) {
        return &spec;
      }
    }
    return nullptr;
  }

  [[nodiscard]] const BlockPortSpec* port(const std::string& name) const {
    for (const BlockPortSpec& spec : ports) {
      if (spec.name == name) {
        return &spec;
      }
    }
    return nullptr;
  }

  [[nodiscard]] bool has_input_ports() const {
    for (const BlockPortSpec& spec : ports) {
      if (spec.direction == "in" || spec.direction == "inout") {
        return true;
      }
    }
    return false;
  }

  [[nodiscard]] bool has_output_ports() const {
    for (const BlockPortSpec& spec : ports) {
      if (spec.direction == "out" || spec.direction == "inout") {
        return true;
      }
    }
    return false;
  }
};

// Registry loaded from DSL `library` declarations.
class LibraryRegistry {
public:
  // Parse a library source into shapes. Returns false (and fills
  // `diagnostics` when non-null) if the source does not parse.
  [[nodiscard]] bool load(const std::string& source, std::vector<Diagnostic>* diagnostics);
  // Parse a library source and append its shapes (used to layer a custom
  // library over the built-in registry).
  [[nodiscard]] bool merge(const std::string& source, std::vector<Diagnostic>* diagnostics);

  // Accepts either a short name or `library::block`. A short name resolves
  // only when exactly one loaded library exports it.
  [[nodiscard]] bool has_block(const std::string& kind) const { return block(kind) != nullptr; }
  [[nodiscard]] const BlockShape* block(const std::string& kind) const;
  [[nodiscard]] bool is_ambiguous(const std::string& kind) const;

  [[nodiscard]] const std::vector<BlockShape>& blocks() const { return blocks_; }

  // Effective shape for `kind`: follows the extends chain to the terminal
  // built-in block (custom `Machine` -> `service`). Returns the block's own
  // shape when it has no mapping, nullptr when unknown.
  [[nodiscard]] const BlockShape* resolve(const std::string& kind) const;

private:
  std::vector<BlockShape> blocks_;
};

// The embedded standard process library (libraries/process.lplib).
[[nodiscard]] const LibraryRegistry& builtin_process_registry();

}  // namespace logicpilot::dsl
