// lpcli `run` subcommand implementation.
#include "run_command.h"

#include <charconv>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include <fmt/format.h>

#include "builtin_registry.h"
#include "logicpilot/core/random/streams.h"
#include "logicpilot/devs/ir_loader.h"
#include "logicpilot/devs/continuous.h"
#include "logicpilot/devs/mm1.h"
#include "logicpilot/devs/replication.h"

namespace logicpilot::cli {
namespace {

bool parse_u64(const std::string& text, std::uint64_t& out) {
  const auto* first = text.data();
  const auto* last = text.data() + text.size();
  return std::from_chars(first, last, out).ec == std::errc{} &&
         first != last;
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

void print_usage() {
  fmt::print(
      "usage: lpcli run [options]\n"
      "  --model <built-in:NAME>    built-in model (default built-in:mm1)\n"
      "  --model-file <path.lpir>   load model from FlatBuffers IR instead\n"
      "  --seed <n>                 run seed (default 42)\n"
      "  --reps <n>                 replications (default 30)\n"
      "  --arrivals <n>             arrivals per replication (default 20000)\n"
      "  --warmup <n>               warmup arrivals excluded from stats\n"
      "  --lambda <x>               arrival rate for built-in:mm1 (default 0.8)\n"
      "  --mu <x>                   service rate for built-in:mm1 (default 1.0)\n"
      "  --confidence <x>           CI confidence level (default 0.95)\n"
      "  --trajectory <path>        write continuous-model trajectory JSON\n");
}

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  // Deterministic per-replication stream sharding (ADR-0007 replay).
  const SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

}  // namespace

int run_command(std::span<const std::string> args) {
  RunOptions options;
  bool explicit_model_file = false;

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
    } else if (arg == "--model") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.model = value;
    } else if (arg == "--model-file") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.model_file = value;
      explicit_model_file = true;
    } else if (arg == "--seed") {
      if (!need_value() || !parse_u64(value, options.seed)) {
        fmt::print(stderr, "error: invalid --seed\n");
        return 2;
      }
    } else if (arg == "--reps") {
      if (!need_value() || !parse_u64(value, options.reps) ||
          options.reps == 0) {
        fmt::print(stderr, "error: invalid --reps\n");
        return 2;
      }
    } else if (arg == "--arrivals") {
      if (!need_value() || !parse_u64(value, options.arrivals) ||
          options.arrivals == 0) {
        fmt::print(stderr, "error: invalid --arrivals\n");
        return 2;
      }
    } else if (arg == "--warmup") {
      if (!need_value() || !parse_u64(value, options.warmup)) {
        fmt::print(stderr, "error: invalid --warmup\n");
        return 2;
      }
    } else if (arg == "--lambda") {
      if (!need_value() || !parse_double(value, options.lambda) ||
          options.lambda <= 0.0) {
        fmt::print(stderr, "error: invalid --lambda\n");
        return 2;
      }
    } else if (arg == "--mu") {
      if (!need_value() || !parse_double(value, options.mu) ||
          options.mu <= 0.0) {
        fmt::print(stderr, "error: invalid --mu\n");
        return 2;
      }
    } else if (arg == "--confidence") {
      if (!need_value() || !parse_double(value, options.confidence) ||
          options.confidence <= 0.0 || options.confidence >= 1.0) {
        fmt::print(stderr, "error: invalid --confidence\n");
        return 2;
      }
    } else if (arg == "--trajectory") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.trajectory = value;
    } else {
      fmt::print(stderr, "error: unknown option {}\n", arg);
      print_usage();
      return 2;
    }
  }

  if (options.warmup >= options.arrivals) {
    fmt::print(stderr, "error: --warmup must be < --arrivals\n");
    return 2;
  }

  // Resolve the executable model.
  std::unique_ptr<ReplicationModel> model;
  std::string model_label;
  if (explicit_model_file) {
    IrLoadResult loaded = load_model_file(options.model_file);
    if (!loaded.ok()) {
      fmt::print(stderr, "error: failed to load IR '{}': {} ({})\n",
                 options.model_file, loaded.message, to_string(loaded.status));
      return 1;
    }
    std::string build_error;
    model = build_replication_model(loaded.file, &build_error);
    if (!model) {
      fmt::print(stderr, "error: {}\n", build_error);
      return 1;
    }
    model_label = fmt::format("file:{} ({})", options.model_file,
                              inspect_model(loaded.file));
  } else {
    if (!options.model.starts_with(kBuiltinPrefix)) {
      fmt::print(stderr,
                 "error: --model must be 'built-in:<name>' or use "
                 "--model-file\n");
      return 2;
    }
    const std::string name = options.model.substr(
        std::char_traits<char>::length(kBuiltinPrefix));
    ModelBuildParams params{options.lambda, options.mu};
    model = BuiltinModelRegistry::instance().create(name, params);
    if (!model) {
      fmt::print(stderr, "error: unknown built-in model '{}'\n", name);
      fmt::print(stderr, "available:");
      for (const std::string& known :
           BuiltinModelRegistry::instance().names()) {
        fmt::print(stderr, " built-in:{}", known);
      }
      fmt::print(stderr, "\n");
      return 2;
    }
    model_label = options.model;
  }

  fmt::print(
      "lpcli run: model={} seed={} reps={} arrivals={} warmup={} "
      "confidence={:.2f}\n",
      model_label, options.seed, options.reps, options.arrivals,
      options.warmup, options.confidence);

  // M/M/1 theory header for the built-in model.
  Mm1Theory theory{};
  const bool is_builtin_mm1 = !explicit_model_file && options.model ==
                                  std::string(kBuiltinPrefix) + "mm1";
  if (is_builtin_mm1) {
    if (options.lambda >= options.mu) {
      fmt::print(stderr,
                 "error: unstable queue (lambda >= mu); theory diverges\n");
      return 2;
    }
    theory = mm1_theory(options.lambda, options.mu);
    fmt::print(
        "theory: rho={:.4f} Wq={:.4f} W={:.4f} L={:.4f} Lq={:.4f} "
        "throughput={:.4f}\n",
        theory.rho, theory.wq, theory.w, theory.l, theory.lq,
        theory.throughput);
  }

  // Run replications (per-replication deterministic stream seeds).
  std::vector<ReplicationMetrics> results;
  results.reserve(options.reps);
  fmt::print(
      "{:>4}  {:>20}  {:>10}  {:>10}  {:>8}  {:>8}  {:>8}  {:>8}\n", "rep",
      "seed", "departures", "throughput", "L", "Lq", "W", "Wq");
  for (std::uint64_t rep = 0; rep < options.reps; ++rep) {
    ReplicationConfig config;
    config.seed = replication_seed(options.seed, rep);
    config.arrivals = options.arrivals;
    config.warmup_arrivals = options.warmup;
    ReplicationMetrics metrics = model->run(config, nullptr);
    fmt::print(
        "{:>4}  {:>20}  {:>10}  {:>10.4f}  {:>8.4f}  {:>8.4f}  {:>8.4f}  "
        "{:>8.4f}\n",
        rep + 1, config.seed, metrics.departures, metrics.throughput,
        metrics.mean_in_system, metrics.mean_in_queue, metrics.mean_sojourn,
        metrics.mean_wait);
    results.push_back(metrics);
  }

  const ReplicationSummary summary =
      summarize_replications(results, options.confidence);
  const auto print_row = [&](const char* label, const MetricSummary& m,
                             double theory_value, bool has_theory) {
    if (has_theory) {
      fmt::print(
          "  {:<12} mean={:.4f} std={:.4f} CI=[{:.4f}, {:.4f}] theory={:.4f} "
          "{}\n",
          label, m.mean, m.stddev, m.ci_low, m.ci_high, theory_value,
          m.covers(theory_value) ? "covered" : "NOT covered");
    } else {
      fmt::print("  {:<12} mean={:.4f} std={:.4f} CI=[{:.4f}, {:.4f}]\n",
                 label, m.mean, m.stddev, m.ci_low, m.ci_high);
    }
  };
  fmt::print("summary: {} replications, {:.0f}% CI\n", summary.reps,
             options.confidence * 100.0);
  print_row("throughput", summary.throughput, theory.throughput,
            is_builtin_mm1);
  print_row("L", summary.mean_in_system, theory.l, is_builtin_mm1);
  print_row("Lq", summary.mean_in_queue, theory.lq, is_builtin_mm1);
  print_row("W", summary.mean_sojourn, theory.w, is_builtin_mm1);
  print_row("Wq", summary.mean_wait, theory.wq, is_builtin_mm1);
  print_row("utilization", summary.utilization, theory.rho, is_builtin_mm1);
  print_row("availability", summary.availability, 0.0, false);
  print_row("final_value", summary.final_value, 0.0, false);

  // Continuous models: write the sampled trajectory as JSON for the web
  // visualization (variables + one point per integration step).
  if (!options.trajectory.empty()) {
    const auto* continuous =
        dynamic_cast<const ContinuousReplicationModel*>(model.get());
    if (continuous != nullptr) {
      std::ofstream out(options.trajectory, std::ios::trunc);
      if (!out) {
        fmt::print(stderr, "error: cannot write '{}'\n", options.trajectory);
        return 1;
      }
      out << "{\"variables\":[";
      const auto& variables = continuous->variables();
      for (std::size_t i = 0; i < variables.size(); ++i) {
        out << (i > 0 ? "," : "") << "\"" << variables[i] << "\"";
      }
      out << "],\"points\":[";
      const auto& trajectory = continuous->trajectory();
      for (std::size_t i = 0; i < trajectory.size(); ++i) {
        const auto& point = trajectory[i];
        out << (i > 0 ? "," : "") << "{\"t\":" << point.t << ",\"values\":[";
        for (std::size_t j = 0; j < point.values.size(); ++j) {
          out << (j > 0 ? "," : "") << point.values[j];
        }
        out << "]}";
      }
      out << "]}\n";
      out.close();
      if (!out) {
        fmt::print(stderr, "error: failed writing '{}'\n",
                   options.trajectory);
        return 1;
      }
    }
  }

  if (is_builtin_mm1 && !summary.mean_wait.covers(theory.wq)) {
    fmt::print(stderr, "warning: Wq CI does not cover theory\n");
    return 1;
  }
  return 0;
}

}  // namespace logicpilot::cli
