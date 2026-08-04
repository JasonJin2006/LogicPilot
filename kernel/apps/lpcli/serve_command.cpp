// lpcli `serve` subcommand implementation (Phase 2c, task #7).
#include "serve_command.h"

#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

#include <fmt/format.h>

#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/diagnostics.h"
#include "server.h"

namespace logicpilot::cli {
namespace {

logicpilot::server::SimServer* g_server = nullptr;

void handle_signal(int) {
  if (g_server != nullptr) {
    g_server->stop();
  }
}

void print_usage() {
  fmt::print(
      "usage: lpcli serve <input.lp> [options]\n"
      "  compiles a .lp DSL model to IR and serves it over WebSocket\n"
      "  --model-file <path>   serve prebuilt IR instead of compiling\n"
      "  --port <n>            listen port (default 8089)\n"
      "  --seed <n>            default run seed (default 42)\n"
      "  --reps <n>            default replications per run (default 1)\n"
      "  --arrivals <n>        arrivals per replication (default 4000)\n"
      "  --warmup <n>          warmup arrivals (default 400)\n"
      "  --speed <x>           wall-clock pacing multiplier (default 1.0)\n"
      "  --trace               mirror every binary frame as JSON\n");
}

bool parse_u64(const std::string& text, std::uint64_t& out) {
  const auto* first = text.data();
  const auto* last = text.data() + text.size();
  return std::from_chars(first, last, out).ec == std::errc{} && first != last;
}

bool parse_double(const std::string& text, double& out) {
  try {
    std::size_t consumed = 0;
    out = std::stod(text, &consumed);
    return consumed == text.size();
  } catch (...) {
    return false;
  }
}

}  // namespace

int serve_command(std::span<const std::string> args) {
  logicpilot::server::ServerConfig config;
  std::string input;
  std::string model_file;

  for (std::size_t i = 0; i < args.size(); ++i) {
    std::string arg = args[i];
    const auto eq = arg.find('=');
    std::string value;
    bool has_inline_value = false;
    if (arg.starts_with("--") && eq != std::string::npos) {
      value = arg.substr(eq + 1);
      arg = arg.substr(0, eq);
      has_inline_value = true;
    }
    const auto need_value = [&]() -> bool {
      if (has_inline_value) {
        return true;
      }
      if (i + 1 < args.size()) {
        value = args[++i];
        return true;
      }
      return false;
    };

    if (arg == "--help" || arg == "-h") {
      print_usage();
      return 0;
    } else if (arg == "--model-file") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      model_file = value;
    } else if (arg == "--port") {
      std::uint64_t port = 0;
      if (!need_value() || !parse_u64(value, port) || port > 65535) {
        fmt::print(stderr, "error: invalid --port\n");
        return 2;
      }
      config.port = static_cast<unsigned short>(port);
    } else if (arg == "--seed") {
      if (!need_value() || !parse_u64(value, config.seed)) {
        fmt::print(stderr, "error: invalid --seed\n");
        return 2;
      }
    } else if (arg == "--reps") {
      if (!need_value() || !parse_u64(value, config.reps) ||
          config.reps == 0) {
        fmt::print(stderr, "error: invalid --reps\n");
        return 2;
      }
    } else if (arg == "--arrivals") {
      if (!need_value() || !parse_u64(value, config.arrivals) ||
          config.arrivals == 0) {
        fmt::print(stderr, "error: invalid --arrivals\n");
        return 2;
      }
    } else if (arg == "--warmup") {
      if (!need_value() || !parse_u64(value, config.warmup)) {
        fmt::print(stderr, "error: invalid --warmup\n");
        return 2;
      }
    } else if (arg == "--speed") {
      if (!need_value() || !parse_double(value, config.speed) ||
          config.speed <= 0.0) {
        fmt::print(stderr, "error: invalid --speed\n");
        return 2;
      }
    } else if (arg == "--trace") {
      config.trace = true;
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

  if (config.warmup >= config.arrivals) {
    fmt::print(stderr, "error: --warmup must be < --arrivals\n");
    return 2;
  }

  // Resolve the model IR: --model-file wins, else compile the .lp source.
  std::vector<std::uint8_t> ir_bytes;
  if (!model_file.empty()) {
    logicpilot::IrLoadResult loaded = logicpilot::load_model_file(model_file);
    if (!loaded.ok()) {
      fmt::print(stderr, "error: failed to load IR '{}': {} ({})\n",
                 model_file, loaded.message,
                 logicpilot::to_string(loaded.status));
      return 1;
    }
    std::string build_error;
    if (!logicpilot::build_replication_model(loaded.file, &build_error)) {
      fmt::print(stderr, "error: {}\n", build_error);
      return 1;
    }
    logicpilot::FlowRunParams flow;
    std::string flow_error;
    if (!logicpilot::extract_flow_params(loaded.file, flow, &flow_error)) {
      fmt::print(stderr, "error: {}\n", flow_error);
      return 1;
    }
    config.lambda = flow.lambda;
    config.mu = flow.mu;
    config.servers = flow.servers;
    config.failure_rate = flow.failure_rate;
    config.repair_rate = flow.repair_rate;
    config.model_name = logicpilot::inspect_model(loaded.file);
  } else {
    if (input.empty()) {
      fmt::print(stderr, "error: missing input .lp (or use --model-file)\n");
      print_usage();
      return 2;
    }
    const logicpilot::dsl::CompileResult compiled =
        logicpilot::dsl::compile_file(input);
    if (!compiled.ok) {
      for (const logicpilot::dsl::Diagnostic& diagnostic :
           compiled.diagnostics) {
        fmt::print(stderr, "{}\n",
                   logicpilot::dsl::format_diagnostic(input, diagnostic));
      }
      fmt::print(stderr, "compile failed: {} error(s)\n",
                 compiled.diagnostics.size());
      return 1;
    }
    ir_bytes = compiled.ir_bytes;
    // Validate + name the model from the freshly compiled IR.
    logicpilot::IrLoadResult loaded =
        logicpilot::load_model_buffer(ir_bytes.data(), ir_bytes.size());
    if (!loaded.ok()) {
      fmt::print(stderr, "error: compiled IR rejected: {}\n", loaded.message);
      return 1;
    }
    std::string build_error;
    if (!logicpilot::build_replication_model(loaded.file, &build_error)) {
      fmt::print(stderr, "error: {}\n", build_error);
      return 1;
    }
    logicpilot::FlowRunParams flow;
    std::string flow_error;
    if (!logicpilot::extract_flow_params(loaded.file, flow, &flow_error)) {
      fmt::print(stderr, "error: {}\n", flow_error);
      return 1;
    }
    config.lambda = flow.lambda;
    config.mu = flow.mu;
    config.servers = flow.servers;
    config.failure_rate = flow.failure_rate;
    config.repair_rate = flow.repair_rate;
    config.model_name = compiled.model_name;
  }

  logicpilot::server::SimServer server{config};
  std::string error;
  if (!server.start(&error)) {
    fmt::print(stderr, "error: cannot listen on port {}: {}\n", config.port,
               error);
    return 1;
  }
  g_server = &server;
  std::signal(SIGINT, handle_signal);
  std::signal(SIGTERM, handle_signal);

  fmt::print(
      "lpcli serve: ws://127.0.0.1:{}/sim  model={}  seed={}  reps={}  "
      "arrivals={}  speed={:g}  trace={}\n",
      server.port(), config.model_name, config.seed, config.reps,
      config.arrivals, config.speed, config.trace ? "on" : "off");
  fmt::print("lpcli serve: send {{\"cmd\":\"start\"}} over WebSocket; "
             "Ctrl+C to exit\n");

  while (server.running()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  server.stop();
  return 0;
}

}  // namespace logicpilot::cli
