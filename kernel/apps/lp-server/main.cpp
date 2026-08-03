// lp-server - standalone WebSocket gateway entry point (task #7).
//
// usage:
//   lp-server --model-file examples/mm1.ir.bin --port 8089 --seed 42 --trace
//   lp-server                                   (built-in M/M/1 defaults)
//
// The server listens on ws://127.0.0.1:<port>/sim and streams wire.fbs
// frames (identifier "LPWR") to every connected client. Control messages
// are JSON text frames; see kernel/apps/lp-server/README.md.
#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <memory>
#include <span>
#include <string>
#include <thread>
#include <vector>

#include <fmt/format.h>

#include "logicpilot/devs/ir_loader.h"
#include "server.h"

namespace {

void print_usage() {
  fmt::print(
      "LogicPilot WebSocket gateway (lp-server)\n"
      "usage: lp-server [options]\n"
      "  --model-file <path>  FlatBuffers IR (.lpir/.ir.bin); default is the\n"
      "                       built-in M/M/1 model\n"
      "  --port <n>           listen port (default 8089; ws://127.0.0.1:P/sim)\n"
      "  --seed <n>           default run seed (default 42)\n"
      "  --reps <n>           default replications per run (default 1)\n"
      "  --arrivals <n>       arrivals per replication (default 4000)\n"
      "  --warmup <n>         warmup arrivals (default 400)\n"
      "  --lambda <x>         arrival rate, built-in mm1 only (default 0.8)\n"
      "  --mu <x>             service rate, built-in mm1 only (default 1.0)\n"
      "  --speed <x>          wall-clock pacing multiplier (default 1.0)\n"
      "  --trace              mirror every binary frame as JSON on stdout\n"
      "  --help               show this message\n");
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

logicpilot::server::SimServer* g_server = nullptr;

void handle_signal(int) {
  if (g_server != nullptr) {
    g_server->stop();
  }
}

}  // namespace

int main(int argc, char** argv) {
  std::span<char*> raw(argv + 1, static_cast<std::size_t>(argc - 1));
  std::vector<std::string> args(raw.begin(), raw.end());

  logicpilot::server::ServerConfig config;
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
    } else if (arg == "--lambda") {
      if (!need_value() || !parse_double(value, config.lambda) ||
          config.lambda <= 0.0) {
        fmt::print(stderr, "error: invalid --lambda\n");
        return 2;
      }
    } else if (arg == "--mu") {
      if (!need_value() || !parse_double(value, config.mu) ||
          config.mu <= 0.0) {
        fmt::print(stderr, "error: invalid --mu\n");
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
    } else {
      fmt::print(stderr, "error: unknown option {}\n", arg);
      print_usage();
      return 2;
    }
  }

  if (config.warmup >= config.arrivals) {
    fmt::print(stderr, "error: --warmup must be < --arrivals\n");
    return 2;
  }

  // Resolve the model: IR file when given, built-in M/M/1 otherwise. The
  // streaming driver (sim_runner) is the M/M/1 lowering, so an IR file is
  // validated + inspected for its name, then executed via the same path as
  // build_replication_model() uses for ProcessModel.
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
    config.model_name = logicpilot::inspect_model(loaded.file);
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
      "lp-server: ws://127.0.0.1:{}/sim  model={}  seed={}  reps={}  "
      "arrivals={}  speed={:g}  trace={}\n",
      server.port(), config.model_name, config.seed, config.reps,
      config.arrivals, config.speed, config.trace ? "on" : "off");
  fmt::print("lp-server: send {{\"cmd\":\"start\"}} over WebSocket to begin; "
             "Ctrl+C to exit\n");

  // Block until stop() runs (signal handler or fatal client error).
  while (server.running()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
  server.stop();
  return 0;
}
