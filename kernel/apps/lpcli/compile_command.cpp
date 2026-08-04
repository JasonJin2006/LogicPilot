// lpcli `compile` subcommand implementation (Phase 2b, task #6).
//
// usage: lpcli compile <input.lp> [-o <output>] [--ir-version 1|2]
//                        [--diagnostics-json <path>]
//                        [--experiments-json <path>]
// Default output: the input path with `.lp` replaced by `.ir.bin`
// (or `.ir.bin` appended). Diagnostics go to stderr; a failing compile
// exits non-zero without writing the IR. --diagnostics-json additionally
// writes the machine-readable diagnostics document (AI copilot loop).
#include "compile_command.h"

#include <filesystem>
#include <fstream>

#include <fmt/format.h>

#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/diagnostics.h"
#include "logicpilot/dsl/experiments_json.h"
#include "logicpilot/dsl/json_diagnostics.h"

namespace logicpilot::cli {
namespace {

void print_usage() {
  fmt::print(
      "usage: lpcli compile <input.lp> [-o <output>]\n"
      "                        [--ir-version 1|2]\n"
      "                        [--diagnostics-json <path>]\n"
      "                        [--experiments-json <path>]\n"
      "  compiles a LogicPilot DSL source to FlatBuffers IR (LPIR)\n"
      "  -o, --output <path>  output file (default <input>.ir.bin)\n"
      "  --ir-version <n>     emit the v2 Node/SemanticsRef contract (2,\n"
      "                       default) or the frozen v1 contract (1)\n"
      "  --diagnostics-json <path>  write machine-readable diagnostics JSON\n"
      "  --experiments-json <path>  write the model's declared experiments\n");
}

std::string default_output_path(const std::string& input) {
  std::filesystem::path path{input};
  if (path.extension() == ".lp") {
    path.replace_extension(".ir.bin");
  } else {
    path += ".ir.bin";
  }
  return path.string();
}

}  // namespace

int compile_command(std::span<const std::string> args) {
  std::string input;
  std::string output;
  std::string diagnostics_json;
  std::string experiments_json;
  int ir_version = 2;

  for (std::size_t i = 0; i < args.size(); ++i) {
    const std::string arg = args[i];
    if (arg == "--help" || arg == "-h") {
      print_usage();
      return 0;
    } else if (arg == "-o" || arg == "--output") {
      if (i + 1 >= args.size()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      output = args[++i];
    } else if (arg == "--diagnostics-json") {
      if (i + 1 >= args.size()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      diagnostics_json = args[++i];
    } else if (arg == "--experiments-json") {
      if (i + 1 >= args.size()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      experiments_json = args[++i];
    } else if (arg == "--ir-version") {
      if (i + 1 >= args.size()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      try {
        ir_version = std::stoi(args[++i]);
      } catch (...) {
        fmt::print(stderr, "error: invalid --ir-version\n");
        return 2;
      }
      if (ir_version != 1 && ir_version != 2) {
        fmt::print(stderr, "error: --ir-version must be 1 or 2\n");
        return 2;
      }
    } else if (arg.starts_with("-")) {
      fmt::print(stderr, "error: unknown option {}\n", arg);
      print_usage();
      return 2;
    } else if (input.empty()) {
      input = arg;
    } else {
      fmt::print(stderr, "error: unexpected argument '{}'\n", arg);
      print_usage();
      return 2;
    }
  }

  if (input.empty()) {
    fmt::print(stderr, "error: missing input file\n");
    print_usage();
    return 2;
  }
  if (output.empty()) {
    output = default_output_path(input);
  }

  const dsl::CompileResult compiled = dsl::compile_file(input);
  const auto write_diagnostics_json = [&](bool ok) -> int {
    if (diagnostics_json.empty()) {
      return ok ? 0 : 1;
    }
    std::ofstream out(diagnostics_json, std::ios::trunc);
    if (!out) {
      fmt::print(stderr, "error: cannot write '{}'\n", diagnostics_json);
      return 1;
    }
    out << dsl::diagnostics_to_json(input, ok, compiled.diagnostics);
    out.close();
    if (!out) {
      fmt::print(stderr, "error: failed writing '{}'\n", diagnostics_json);
      return 1;
    }
    return ok ? 0 : 1;
  };

  if (!compiled.ok) {
    for (const dsl::Diagnostic& diagnostic : compiled.diagnostics) {
      fmt::print(stderr, "{}\n", dsl::format_diagnostic(input, diagnostic));
    }
    fmt::print(stderr, "compile failed: {} error(s)\n",
               compiled.diagnostics.size());
    return write_diagnostics_json(false);
  }

  if (!experiments_json.empty()) {
    std::ofstream out(experiments_json, std::ios::trunc);
    if (!out) {
      fmt::print(stderr, "error: cannot write '{}'\n", experiments_json);
      return 1;
    }
    out << dsl::experiments_to_json(compiled.experiments);
    out.close();
    if (!out) {
      fmt::print(stderr, "error: failed writing '{}'\n", experiments_json);
      return 1;
    }
  }

  const std::vector<std::uint8_t>& output_bytes =
      ir_version == 2 ? compiled.v2_bytes : compiled.ir_bytes;

  std::ofstream out(output, std::ios::binary | std::ios::trunc);
  if (!out) {
    fmt::print(stderr, "error: cannot write '{}'\n", output);
    return 1;
  }
  out.write(reinterpret_cast<const char*>(output_bytes.data()),
            static_cast<std::streamsize>(output_bytes.size()));
  out.close();
  if (!out) {
    fmt::print(stderr, "error: failed writing '{}'\n", output);
    return 1;
  }

  fmt::print("compiled '{}' -> '{}' (model '{}', {} bytes)\n", input, output,
             compiled.model_name, output_bytes.size());
  return write_diagnostics_json(true);
}

}  // namespace logicpilot::cli
