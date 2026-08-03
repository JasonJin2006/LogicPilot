// lpcli `compile` subcommand implementation (Phase 2b, task #6).
//
// usage: lpcli compile <input.lp> [-o <output>]
// Default output: the input path with `.lp` replaced by `.ir.bin`
// (or `.ir.bin` appended). Diagnostics go to stderr; a failing compile
// exits non-zero without writing anything.
#include "compile_command.h"

#include <filesystem>
#include <fstream>

#include <fmt/format.h>

#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/diagnostics.h"

namespace logicpilot::cli {
namespace {

void print_usage() {
  fmt::print(
      "usage: lpcli compile <input.lp> [-o <output>]\n"
      "  compiles a LogicPilot DSL source to FlatBuffers IR (LPIR)\n"
      "  -o, --output <path>  output file (default <input>.ir.bin)\n");
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
  if (!compiled.ok) {
    for (const dsl::Diagnostic& diagnostic : compiled.diagnostics) {
      fmt::print(stderr, "{}\n", dsl::format_diagnostic(input, diagnostic));
    }
    fmt::print(stderr, "compile failed: {} error(s)\n",
               compiled.diagnostics.size());
    return 1;
  }

  std::ofstream out(output, std::ios::binary | std::ios::trunc);
  if (!out) {
    fmt::print(stderr, "error: cannot write '{}'\n", output);
    return 1;
  }
  out.write(reinterpret_cast<const char*>(compiled.ir_bytes.data()),
            static_cast<std::streamsize>(compiled.ir_bytes.size()));
  out.close();
  if (!out) {
    fmt::print(stderr, "error: failed writing '{}'\n", output);
    return 1;
  }

  fmt::print("compiled '{}' -> '{}' (model '{}', {} bytes)\n", input, output,
             compiled.model_name, compiled.ir_bytes.size());
  return 0;
}

}  // namespace logicpilot::cli
