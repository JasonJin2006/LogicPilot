// End-to-end compile pipeline implementation.
#include "logicpilot/dsl/compile.h"

#include <fstream>
#include <sstream>
#include <utility>

#include "logicpilot/dsl/lowering.h"
#include "logicpilot/dsl/parser.h"
#include "logicpilot/dsl/registry.h"
#include "logicpilot/dsl/semantic.h"
#include "logicpilot/dsl/stdlib_process.h"

#include <filesystem>
#include <cmath>
#include <fstream>
#include <sstream>

namespace logicpilot::dsl {

// Hard input guard (toolchain hardening): tree-sitter is iterative and
// robust to deep nesting, but unbounded inputs still cost memory/time on
// the host. Reject oversized sources up front with a structured diagnostic
// instead of letting the parser chew through them.
inline constexpr std::size_t kMaxSourceBytes = 16 * 1024 * 1024;  // 16 MiB

namespace {

std::string read_text_file(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return "";
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

// Locate `<name>.lplib` on the search path: explicit dirs, then the model's
// own directory, then `libraries/` under the working directory.
std::string find_library(const std::string& name, const std::string& model_path,
                         const std::vector<std::string>& library_dirs) {
  const std::string file_name = name + ".lplib";
  std::vector<std::string> dirs = library_dirs;
  if (!model_path.empty()) {
    dirs.push_back(std::filesystem::path(model_path).parent_path().string());
  }
  dirs.push_back("libraries");
  for (const std::string& dir : dirs) {
    if (dir.empty()) {
      continue;
    }
    const std::string candidate =
        (std::filesystem::path(dir) / file_name).string();
    if (std::filesystem::exists(candidate)) {
      return candidate;
    }
  }
  return "";
}

}  // namespace

CompileResult compile_source(const std::string& source,
                             const std::string& path) {
  return compile_source(source, path, {});
}

CompileResult compile_source(const std::string& source,
                             const std::string& path,
                             const std::vector<std::string>& library_dirs) {
  return compile_source(source, path, library_dirs, {});
}

CompileResult compile_source(const std::string& source,
                             const std::string& path,
                             const std::vector<std::string>& library_dirs,
                             const ParameterOverrides& parameter_overrides) {
  CompileResult result;

  if (source.size() > kMaxSourceBytes) {
    Diagnostic diagnostic;
    diagnostic.severity = Severity::kError;
    diagnostic.code = "LP0003";
    diagnostic.message =
        "source is " + std::to_string(source.size()) + " bytes, exceeding " +
        "the " + std::to_string(kMaxSourceBytes) +
        "-byte input limit (LP0003)";
    result.diagnostics.push_back(std::move(diagnostic));
    return result;
  }

  ParseOutput parsed = parse_source(source, path);
  if (!parsed.ok()) {
    result.diagnostics = std::move(parsed.diagnostics);
    return result;
  }

  std::unordered_map<std::string, bool> override_found;
  for (const auto& [name, value] : parameter_overrides) {
    override_found.emplace(name, false);
    if (!std::isfinite(value)) {
      Diagnostic diagnostic;
      diagnostic.severity = Severity::kError;
      diagnostic.code = "LP3001";
      diagnostic.message = "parameter override '" + name + "' must be finite";
      result.diagnostics.push_back(std::move(diagnostic));
    }
  }
  for (VarDecl& param : parsed.model->params) {
    const auto found = parameter_overrides.find(param.name);
    if (found == parameter_overrides.end()) continue;
    override_found[param.name] = true;
    const double value = found->second;
    const bool integer_param = param.type == "int" ||
                               param.value.kind == ValueKind::kInt;
    if (integer_param && std::floor(value) != value) {
      Diagnostic diagnostic;
      diagnostic.severity = Severity::kError;
      diagnostic.code = "LP3001";
      diagnostic.message = "integer parameter '" + param.name +
                           "' cannot be overridden with non-integer value " +
                           std::to_string(value);
      diagnostic.span = param.name_span;
      result.diagnostics.push_back(std::move(diagnostic));
      continue;
    }
    param.value.kind = integer_param ? ValueKind::kInt : ValueKind::kFloat;
    param.value.int_value = static_cast<std::int64_t>(value);
    param.value.float_value = value;
    param.value.operands.clear();
    param.value.call_args.clear();
    param.value.string_value.clear();
  }
  for (const auto& [name, found] : override_found) {
    if (!found) {
      Diagnostic diagnostic;
      diagnostic.severity = Severity::kError;
      diagnostic.code = "LP7001";
      diagnostic.message = "parameter override references unknown top-level param '" +
                           name + "'";
      result.diagnostics.push_back(std::move(diagnostic));
    }
  }
  if (!result.diagnostics.empty()) return result;

  // Layer `use`d libraries over the built-in process registry.
  LibraryRegistry registry;
  std::vector<Diagnostic> registry_diagnostics;
  (void)registry.load(stdlib_process_source(), &registry_diagnostics);
  std::vector<std::string> loaded_libraries;
  std::vector<Diagnostic> library_errors;
  for (const std::string& library : parsed.model->used_libraries) {
    if (library == "process") {
      loaded_libraries.push_back(library);
      continue;
    }
    const std::string lib_path = find_library(library, path, library_dirs);
    if (lib_path.empty()) {
      Diagnostic diagnostic;
      diagnostic.severity = Severity::kError;
      diagnostic.code = "LP2010";
      diagnostic.message =
          "cannot find library '" + library + "' (searched library dirs, " +
          "the model directory and 'libraries/')";
      library_errors.push_back(std::move(diagnostic));
      continue;
    }
    const std::string source_text = read_text_file(lib_path);
    const ParseLibraryOutput library_parsed =
        parse_library_source(source_text, lib_path);
    if (!library_parsed.ok()) {
      for (const Diagnostic& diagnostic : library_parsed.diagnostics) {
        library_errors.push_back(diagnostic);
      }
      continue;
    }
    if (library_parsed.library->name != library) {
      Diagnostic diagnostic;
      diagnostic.severity = Severity::kError;
      diagnostic.code = "LP2011";
      diagnostic.message = "library file '" + lib_path + "' declares '" +
                           library_parsed.library->name + "' but `use " +
                           library + "` was requested";
      library_errors.push_back(std::move(diagnostic));
      continue;
    }
    (void)registry.merge(source_text, nullptr);
    loaded_libraries.push_back(library);
  }
  if (!library_errors.empty()) {
    result.diagnostics = std::move(library_errors);
    return result;
  }

  std::vector<Diagnostic> semantic =
      analyze_model(*parsed.model, &registry, &loaded_libraries);
  if (!semantic.empty()) {
    result.diagnostics = std::move(semantic);
    return result;
  }

  LoweredIr lowered = lower_to_ir_v2(*parsed.model, path, &registry, &source);
  result.ok = true;
  result.v2_bytes = std::move(lowered.bytes);
  result.model_name = parsed.model->name;
  result.experiments = std::move(parsed.model->experiments);
  return result;
}

CompileResult compile_file(const std::string& path) {
  return compile_file(path, {});
}

CompileResult compile_file(const std::string& path,
                           const std::vector<std::string>& library_dirs) {
  return compile_file(path, library_dirs, {});
}

CompileResult compile_file(const std::string& path,
                           const std::vector<std::string>& library_dirs,
                           const ParameterOverrides& parameter_overrides) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    CompileResult result;
    Diagnostic diagnostic;
    diagnostic.severity = Severity::kError;
    diagnostic.code = "LP0002";
    diagnostic.message = "cannot read file '" + path + "'";
    result.diagnostics.push_back(std::move(diagnostic));
    return result;
  }
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return compile_source(buffer.str(), path, library_dirs, parameter_overrides);
}

}  // namespace logicpilot::dsl
