// Library registry implementation: loads block shapes from DSL library
// sources (parse_library_source -> LibraryAst -> BlockShape table).
#include "logicpilot/dsl/registry.h"

#include <unordered_map>
#include <utility>

#include "logicpilot/dsl/parser.h"
#include "logicpilot/dsl/stdlib_process.h"

namespace logicpilot::dsl {

BlockParamType block_param_type(const std::string& type_name) {
  if (type_name == "int")
    return BlockParamType::kInt;
  if (type_name == "float")
    return BlockParamType::kFloat;
  if (type_name == "bool")
    return BlockParamType::kBool;
  if (type_name == "string")
    return BlockParamType::kString;
  if (type_name == "distribution")
    return BlockParamType::kDistribution;
  if (type_name == "ref")
    return BlockParamType::kRef;
  if (type_name == "expression")
    return BlockParamType::kExpression;
  return BlockParamType::kUnknown;
}

const char* block_param_type_name(BlockParamType type) {
  switch (type) {
    case BlockParamType::kInt:
      return "int";
    case BlockParamType::kFloat:
      return "float";
    case BlockParamType::kBool:
      return "bool";
    case BlockParamType::kString:
      return "string";
    case BlockParamType::kDistribution:
      return "distribution";
    case BlockParamType::kRef:
      return "ref";
    case BlockParamType::kExpression:
      return "expression";
    case BlockParamType::kUnknown:
      return "unknown";
  }
  return "unknown";
}

bool LibraryRegistry::merge(const std::string& source, std::vector<Diagnostic>* diagnostics) {
  const ParseLibraryOutput parsed = parse_library_source(source, "<library>");
  if (!parsed.ok()) {
    if (diagnostics != nullptr) {
      *diagnostics = parsed.diagnostics;
    }
    return false;
  }
  const LibraryAst& library = *parsed.library;
  // A qualified identity must be unique. Equal short names from different
  // libraries are legal and require `library::block` at the use site.
  std::unordered_map<std::string, bool> pending_names;
  for (const LibraryBlock& block : library.blocks) {
    const std::string qualified = library.name + "::" + block.kind;
    const BlockShape* existing = this->block(qualified);
    if (existing != nullptr || pending_names.count(qualified) > 0) {
      if (diagnostics != nullptr) {
        Diagnostic diagnostic;
        diagnostic.severity = Severity::kError;
        diagnostic.code = "LP2012";
        diagnostic.span = block.span;
        diagnostic.message = "duplicate block '" + qualified + "'";
        diagnostics->push_back(std::move(diagnostic));
      }
      return false;
    }
    pending_names.emplace(qualified, true);
  }
  for (const LibraryBlock& block : library.blocks) {
    BlockShape shape;
    shape.library = library.name;
    shape.library_version = library.version;
    shape.kind = block.kind;
    for (const LibraryParam& param : block.params) {
      // `extends: ref = <kind>` declares a mapping onto a built-in block;
      // it is a registry directive, not a model-facing field.
      if (param.name == "extends" && param.type == "ref" && param.has_default &&
          param.default_value.kind == ValueKind::kIdentifier) {
        shape.extends_kind = param.default_value.string_value;
        continue;
      }
      BlockParamSpec spec;
      spec.name = param.name;
      spec.type = block_param_type(param.type);
      spec.required = !param.has_default;
      shape.params.push_back(std::move(spec));
    }
    for (const LibraryPort& port : block.ports) {
      BlockPortSpec spec;
      spec.name = port.name;
      spec.direction = port.direction;
      spec.type = port.type;
      spec.condition = port.condition;
      shape.ports.push_back(std::move(spec));
    }
    blocks_.push_back(std::move(shape));
  }
  return true;
}

bool LibraryRegistry::load(const std::string& source, std::vector<Diagnostic>* diagnostics) {
  blocks_.clear();
  return merge(source, diagnostics);
}

const BlockShape* LibraryRegistry::block(const std::string& key) const {
  const std::size_t separator = key.find("::");
  const bool qualified = separator != std::string::npos;
  const std::string library = qualified ? key.substr(0, separator) : std::string{};
  const std::string kind = qualified ? key.substr(separator + 2) : key;
  const BlockShape* match = nullptr;
  for (const BlockShape& shape : blocks_) {
    if (shape.kind != kind || (qualified && shape.library != library)) {
      continue;
    }
    if (match != nullptr) {
      return nullptr;  // ambiguous short name
    }
    match = &shape;
  }
  return match;
}

bool LibraryRegistry::is_ambiguous(const std::string& kind) const {
  if (kind.find("::") != std::string::npos) {
    return false;
  }
  std::size_t matches = 0;
  for (const BlockShape& shape : blocks_) {
    if (shape.kind == kind && ++matches > 1) {
      return true;
    }
  }
  return false;
}

const BlockShape* LibraryRegistry::resolve(const std::string& kind) const {
  const BlockShape* shape = block(kind);
  // Guard against extends cycles (a malformed library); cap the chain.
  for (int hops = 0; shape != nullptr && !shape->extends_kind.empty() && hops < 32; ++hops) {
    shape = block(shape->extends_kind);
  }
  return shape;
}

const LibraryRegistry& builtin_process_registry() {
  static const LibraryRegistry registry = [] {
    LibraryRegistry registry;
    // The embedded standard library must always parse; a dedicated test
    // pins the expected block set. A failure here leaves an empty registry
    // (model blocks then fail with LP2004 unknown kind).
    std::vector<Diagnostic> diagnostics;
    (void)registry.load(stdlib_process_source(), &diagnostics);
    return registry;
  }();
  return registry;
}

}  // namespace logicpilot::dsl
