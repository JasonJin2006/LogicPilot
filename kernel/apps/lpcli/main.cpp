// lpcli - LogicPilot command line entry point.
//
// Subcommands (Phase 1b): run. The compile subcommand lands with the DSL
// compiler (Phase 2) and plugs into the same dispatch table.
#include <span>
#include <string>
#include <vector>

#include <fmt/format.h>

#include "builtin_registry.h"
#include "run_command.h"

namespace {

void print_root_usage() {
  fmt::print(
      "LogicPilot CLI\n"
      "usage: lpcli <command> [options]\n"
      "commands:\n"
      "  run     run replications of a model (lpcli run --help)\n"
      "  help    show this message\n");
}

}  // namespace

int main(int argc, char** argv) {
  std::vector<std::string> args(argv + 1, argv + argc);
  logicpilot::cli::register_builtin_models();

  if (args.empty()) {
    print_root_usage();
    return 2;
  }
  const std::string command = args.front();
  std::span<const std::string> rest{args.data() + 1, args.size() - 1};

  if (command == "run") {
    return logicpilot::cli::run_command(rest);
  }
  if (command == "help" || command == "--help" || command == "-h") {
    print_root_usage();
    return 0;
  }
  fmt::print(stderr, "error: unknown command '{}'\n", command);
  print_root_usage();
  return 2;
}
