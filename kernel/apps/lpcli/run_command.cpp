// lpcli `run` subcommand implementation.
#include "run_command.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <fmt/format.h>

#include "logicpilot/core/random/streams.h"
#include "logicpilot/runtime/ir_loader.h"
#include "logicpilot/devs/continuous.h"
#include "logicpilot/runtime/replication.h"
#include "logicpilot/devs/trace_codec.h"
#include "logicpilot/devs/trace_store.h"
#include "logicpilot/runtime/simulation_kernel.h"
#include "ir_v2_generated.h"
#include "register.h"
#ifdef LOGICPILOT_HAS_DSL
#include "logicpilot/dsl/compile.h"
#include "logicpilot/dsl/diagnostics.h"
#include "project_io.h"
#endif

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
      "  --experiment <name>        use a declared simulation experiment\n"
#ifdef LOGICPILOT_HAS_DSL
      "  --project <path.lpproj>    compile the bundled DSL and run it\n"
      "  --output-ir <path>         write the compiled IR (with --project)\n"
      "  --results-dir <path>       write run.json + metrics.json here\n"
      "                             (default <project stem>.results/)\n"
#endif
      "  --seed <n>                 run seed (default 42)\n"
      "  --random-seed              generate and report a unique run seed\n"
      "  --reps <n>                 replications (default 30)\n"
      "  --precision-reps           stop when a relative CI error is reached\n"
      "  --min-reps <n>             minimum precision replications (default 5)\n"
      "  --max-reps <n>             maximum precision replications (default 100)\n"
      "  --error-percent <x>        target CI half-width / |mean| (default 5)\n"
      "  --precision-metric <name>  throughput/L/Lq/W/Wq/... (default Wq)\n"
      "  --threads <n>              parallel replication workers (default 1)\n"
      "  --arrivals <n>             arrivals per replication (default 20000)\n"
      "  --warmup <n>               warmup arrivals excluded from stats\n"
      "  --lambda <x>               arrival rate for built-in:mm1 (default 0.8)\n"
      "  --mu <x>                   service rate for built-in:mm1 (default 1.0)\n"
      "  --confidence <x>           CI confidence level (default 0.95)\n"
      "  --trajectory <path>        write continuous-model trajectory JSON\n"
      "  --logical-trace <path>     write one-rep LPLT logical-step archive\n");
}

std::uint64_t replication_seed(std::uint64_t run_seed, std::uint64_t rep) {
  // Deterministic per-replication stream sharding (ADR-0007 replay).
  const SeedStreams streams{run_seed};
  return streams.derive_state(rep)[0];
}

std::string json_double(double value) {
  if (!std::isfinite(value)) return "null";
  return fmt::format("{:.6g}", value);
}

void write_metric(std::ofstream& out, const char* name,
                  const MetricSummary& summary, bool first) {
  out << (first ? "" : ",") << "\n    \"" << name << "\":{"
      << "\"mean\":" << json_double(summary.mean)
      << ",\"stddev\":" << json_double(summary.stddev)
      << ",\"ci_low\":" << json_double(summary.ci_low)
      << ",\"ci_high\":" << json_double(summary.ci_high) << "}";
}

void write_block(std::ofstream& out, const BlockMetrics& block) {
  out << "{\"name\":\"" << json_escape(block.name) << "\",\"kind\":\""
      << json_escape(block.kind) << "\",\"arrived\":" << block.arrived
      << ",\"departed\":" << block.departed
      << ",\"timed_out\":" << block.timed_out
      << ",\"preempted\":" << block.preempted
      << ",\"capacity\":" << block.capacity
      << ",\"mean_occupancy\":" << json_double(block.mean_occupancy)
      << ",\"mean_wait\":" << json_double(block.mean_wait)
      << ",\"wait_count\":" << block.wait_count
      << ",\"utilization\":" << json_double(block.utilization)
      << ",\"availability\":" << json_double(block.availability) << "}";
}

// Write run.json (config + provenance) and metrics.json (summary + per-rep
// rows) under `dir`, creating it as needed.
int write_results(const std::string& dir, const RunOptions& options,
                  const std::string& input_label,
                  const ReplicationSummary& summary,
                  const std::vector<ReplicationMetrics>& results) {
  std::error_code error;
  std::filesystem::create_directories(dir, error);
  if (error) {
    fmt::print(stderr, "error: cannot create results dir '{}': {}\n", dir,
               error.message());
    return 1;
  }

  std::time_t now = std::time(nullptr);
  std::tm utc{};
#ifdef _WIN32
  gmtime_s(&utc, &now);
#else
  gmtime_r(&now, &utc);
#endif
  const std::string timestamp = fmt::format(
      "{:04d}-{:02d}-{:02d}T{:02d}:{:02d}:{:02d}Z", utc.tm_year + 1900,
      utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec);

  {
    std::ofstream out(dir + "/run.json", std::ios::trunc);
    if (!out) {
      fmt::print(stderr, "error: cannot write '{}/run.json'\n", dir);
      return 1;
    }
    out << "{\n"
        << "  \"input\": \"" << json_escape(input_label) << "\",\n"
        << "  \"seed\": " << options.seed << ",\n"
        << "  \"seedMode\": \"" << (options.random_seed ? "random" : "fixed") << "\",\n"
        << "  \"reps\": " << options.reps << ",\n"
        << "  \"actualReps\": " << summary.reps << ",\n"
        << "  \"replicationMode\": \"" << (options.precision_reps ? "precision" : "fixed") << "\",\n"
        << "  \"minReps\": " << options.min_reps << ",\n"
        << "  \"maxReps\": " << options.max_reps << ",\n"
        << "  \"errorPercent\": " << json_double(options.error_percent) << ",\n"
        << "  \"precisionMetric\": \"" << json_escape(options.precision_metric) << "\",\n"
        << "  \"arrivals\": " << options.arrivals << ",\n"
        << "  \"warmup\": " << options.warmup << ",\n"
        << "  \"confidence\": " << json_double(options.confidence) << ",\n"
        << "  \"schemaVersion\": 2,\n"
        << "  \"timestamp\": \"" << timestamp << "\"\n"
        << "}\n";
    out.close();
    if (!out) {
      fmt::print(stderr, "error: failed writing '{}/run.json'\n", dir);
      return 1;
    }
  }

  {
    std::ofstream out(dir + "/metrics.json", std::ios::trunc);
    if (!out) {
      fmt::print(stderr, "error: cannot write '{}/metrics.json'\n", dir);
      return 1;
    }
    out << "{\n  \"summary\": {";
    write_metric(out, "throughput", summary.throughput, true);
    write_metric(out, "L", summary.mean_in_system, false);
    write_metric(out, "Lq", summary.mean_in_queue, false);
    write_metric(out, "W", summary.mean_sojourn, false);
    write_metric(out, "Wq", summary.mean_wait, false);
    const bool has_measure =
        std::any_of(results.begin(), results.end(), [](const ReplicationMetrics& m) {
          return m.measure_count > 0;
        });
    if (has_measure) {
      write_metric(out, "measure", summary.mean_measure, false);
    }
    write_metric(out, "utilization", summary.utilization, false);
    write_metric(out, "availability", summary.availability, false);
    write_metric(out, "final_value", summary.final_value, false);
    out << "\n  },\n  \"blocks\": [";
    if (!results.empty()) {
      for (std::size_t block_index = 0;
           block_index < results.front().blocks.size(); ++block_index) {
        const BlockMetrics& identity = results.front().blocks[block_index];
        double arrived = 0.0;
        double departed = 0.0;
        double timed_out = 0.0;
        double preempted = 0.0;
        double occupancy = 0.0;
        double stage_wait_sum = 0.0;
        double stage_wait_count = 0.0;
        double utilization = 0.0;
        double availability = 0.0;
        std::size_t samples = 0;
        for (const ReplicationMetrics& replication : results) {
          const auto match = std::find_if(
              replication.blocks.begin(), replication.blocks.end(),
              [&](const BlockMetrics& candidate) {
                return candidate.name == identity.name &&
                       candidate.kind == identity.kind;
              });
          if (match == replication.blocks.end()) {
            continue;
          }
          arrived += static_cast<double>(match->arrived);
          departed += static_cast<double>(match->departed);
          timed_out += static_cast<double>(match->timed_out);
          preempted += static_cast<double>(match->preempted);
          occupancy += match->mean_occupancy;
          stage_wait_sum += match->mean_wait *
                            static_cast<double>(match->wait_count);
          stage_wait_count += static_cast<double>(match->wait_count);
          utilization += match->utilization;
          availability += match->availability;
          ++samples;
        }
        const double divisor = samples > 0 ? static_cast<double>(samples) : 1.0;
        out << (block_index > 0 ? "," : "") << "\n    {\"name\":\""
            << json_escape(identity.name) << "\",\"kind\":\""
            << json_escape(identity.kind) << "\",\"capacity\":"
            << identity.capacity << ",\"arrived_mean\":"
            << json_double(arrived / divisor) << ",\"departed_mean\":"
            << json_double(departed / divisor) << ",\"timed_out_mean\":"
            << json_double(timed_out / divisor) << ",\"preempted_mean\":"
            << json_double(preempted / divisor) << ",\"mean_occupancy\":"
            << json_double(occupancy / divisor) << ",\"mean_wait\":"
            << json_double(stage_wait_count > 0.0
                               ? stage_wait_sum / stage_wait_count
                               : 0.0)
            << ",\"wait_count_mean\":"
            << json_double(stage_wait_count / divisor) << ",\"utilization\":"
            << json_double(utilization / divisor) << ",\"availability\":"
            << json_double(availability / divisor) << "}";
      }
    }
    out << "\n  ],\n  \"replications\": [";
    for (std::size_t i = 0; i < results.size(); ++i) {
      const ReplicationMetrics& m = results[i];
      out << (i > 0 ? "," : "") << "\n    {\"rep\":" << (i + 1)
          << ",\"seed\":\"" << replication_seed(options.seed, i) << "\""
          << ",\"arrivals\":" << m.arrivals
          << ",\"departures\":" << m.departures
          << ",\"throughput\":" << json_double(m.throughput)
          << ",\"L\":" << json_double(m.mean_in_system)
          << ",\"Lq\":" << json_double(m.mean_in_queue)
          << ",\"W\":" << json_double(m.mean_sojourn)
          << ",\"Wq\":" << json_double(m.mean_wait)
          << ",\"measure\":" << json_double(m.mean_measure)
          << ",\"utilization\":" << json_double(m.utilization)
          << ",\"availability\":" << json_double(m.availability)
          << ",\"final_value\":" << json_double(m.final_value)
          << ",\"blocks\":[";
      for (std::size_t block_index = 0; block_index < m.blocks.size();
           ++block_index) {
        out << (block_index > 0 ? "," : "");
        write_block(out, m.blocks[block_index]);
      }
      out << "]}";
    }
    out << "\n  ]\n}\n";
    out.close();
    if (!out) {
      fmt::print(stderr, "error: failed writing '{}/metrics.json'\n", dir);
      return 1;
    }
  }
  fmt::print("results written to '{}' (run.json, metrics.json)\n", dir);
  return 0;
}

bool apply_declared_experiment(const IrModelFile& file, RunOptions& options,
                               bool explicit_seed, bool explicit_reps,
                               std::string& error) {
  if (options.experiment.empty()) {
    return true;
  }
  const auto* experiments = file.v2_root->experiments();
  if (experiments == nullptr) {
    error = "model declares no experiments";
    return false;
  }
  for (const ir::v2::Experiment* experiment : *experiments) {
    if (experiment->name() == nullptr ||
        experiment->name()->str() != options.experiment) {
      continue;
    }
    if (experiment->kind() != ir::v2::ExperimentKind_Simulation) {
      error = "experiment '" + options.experiment +
              "' is not a simulation experiment";
      return false;
    }
    if (!explicit_seed) {
      options.seed = experiment->seed();
      options.random_seed =
          experiment->seed_policy() == ir::v2::SeedPolicy_Random;
    }
    if (!explicit_reps) {
      options.reps = experiment->replications();
      options.precision_reps =
          experiment->replication_policy() ==
          ir::v2::ReplicationPolicy_Precision;
      options.min_reps = experiment->min_replications();
      options.max_reps = experiment->max_replications();
      options.confidence = experiment->confidence();
      options.error_percent = experiment->error_percent();
      if (experiment->precision_metric() != nullptr &&
          !experiment->precision_metric()->str().empty()) {
        options.precision_metric = experiment->precision_metric()->str();
      }
    }
    if (options.reps == 0) {
      error = "experiment '" + options.experiment +
              "' has zero replications";
      return false;
    }
    return true;
  }
  error = "simulation experiment '" + options.experiment + "' not found";
  return false;
}

void write_kernel_metric(std::ofstream& out, const ReplicationMetrics& metrics) {
  out << "{\"arrivals\":" << metrics.arrivals
      << ",\"departures\":" << metrics.departures
      << ",\"horizon_seconds\":" << json_double(metrics.horizon_seconds)
      << ",\"throughput\":" << json_double(metrics.throughput)
      << ",\"L\":" << json_double(metrics.mean_in_system)
      << ",\"Lq\":" << json_double(metrics.mean_in_queue)
      << ",\"W\":" << json_double(metrics.mean_sojourn)
      << ",\"Wq\":" << json_double(metrics.mean_wait)
      << ",\"final_value\":" << json_double(metrics.final_value) << "}";
}

// User-facing multi-method entry point. The legacy ReplicationModel adapter is
// intentionally single-method; mixed models must go through SimulationKernel
// so a Process child cannot silently swallow Statechart/Agent/SD siblings.
int run_kernel_model(const IrModelFile& file, RunOptions options,
                     const std::string& label) {
  if (options.threads > 1) {
    fmt::print(stderr,
               "error: multi-method SimulationKernel runs currently require --threads 1\n");
    return 2;
  }
  if (!options.logical_trace.empty()) {
    fmt::print(stderr,
               "error: --logical-trace is not supported for mixed-method runs; "
               "use a single Agent/Continuous model\n");
    return 2;
  }
  if (options.precision_reps) {
    fmt::print(stderr,
               "error: precision replication is not yet defined for mixed-method metrics; "
               "use fixed --reps\n");
    return 2;
  }
  if (!options.trajectory.empty()) {
    fmt::print(stderr,
               "error: --trajectory is only supported for a single continuous method\n");
    return 2;
  }

  const std::vector<std::string> methods = resolve_method_names(file);
  if (methods.size() < 2) {
    fmt::print(stderr, "error: internal mixed-model dispatch received one method\n");
    return 2;
  }
  register_all_methods();
  SimulationKernel kernel;
  std::string error;
  if (!kernel.load(file, &error)) {
    fmt::print(stderr, "error: cannot load mixed model '{}': {}\n", label, error);
    return 1;
  }
  if (options.random_seed) options.seed = random_run_seed();

  const std::uint64_t run_limit = options.reps;
  std::vector<std::vector<ReplicationMetrics>> per_method(methods.size());
  for (std::uint64_t rep = 0; rep < run_limit; ++rep) {
    ReplicationConfig config;
    config.seed = replication_seed(options.seed, rep);
    config.arrivals = options.arrivals;
    config.warmup_arrivals = options.warmup;
    std::vector<RuntimeDiagnostic> diagnostics;
    const std::vector<ReplicationMetrics> metrics =
        kernel.run(config, nullptr, &error, &diagnostics);
    if (!error.empty() || metrics.size() != methods.size()) {
      fmt::print(stderr, "error: mixed-model replication {} failed: {}\n", rep + 1,
                 error.empty() ? "runtime returned an incomplete metric set" : error);
      for (const RuntimeDiagnostic& diagnostic : diagnostics) {
        fmt::print(stderr, "  {}\n", format_runtime_diagnostic(diagnostic));
      }
      return 1;
    }
    for (std::size_t method = 0; method < methods.size(); ++method) {
      per_method[method].push_back(metrics[method]);
      fmt::print("rep {:>3}  method={:<12} arrivals={:<8} departures={:<8} "
                 "horizon={:.4f} final={:.6g}\n",
                 rep + 1, methods[method], metrics[method].arrivals,
                 metrics[method].departures, metrics[method].horizon_seconds,
                 metrics[method].final_value);
    }
  }

  fmt::print("summary: {} mixed methods, {} replications, shared SimulationKernel\n",
             methods.size(), run_limit);
  if (options.results_dir.empty()) return 0;

  std::error_code fs_error;
  std::filesystem::create_directories(options.results_dir, fs_error);
  if (fs_error) {
    fmt::print(stderr, "error: cannot create results dir '{}': {}\n",
               options.results_dir, fs_error.message());
    return 1;
  }
  std::ofstream run_out(options.results_dir + "/run.json", std::ios::trunc);
  std::ofstream metrics_out(options.results_dir + "/metrics.json", std::ios::trunc);
  if (!run_out || !metrics_out) {
    fmt::print(stderr, "error: cannot write mixed-model results in '{}'\n",
               options.results_dir);
    return 1;
  }
  run_out << "{\"input\":\"" << json_escape(label)
          << "\",\"mode\":\"multi-method\",\"methods\":[";
  for (std::size_t i = 0; i < methods.size(); ++i) {
    run_out << (i == 0 ? "" : ",") << "\"" << json_escape(methods[i]) << "\"";
  }
  run_out << "],\"seed\":" << options.seed << ",\"reps\":" << run_limit
          << ",\"arrivals\":" << options.arrivals
          << ",\"warmup\":" << options.warmup << "}\n";
  metrics_out << "{\"mode\":\"multi-method\",\"methods\":[";
  for (std::size_t method = 0; method < methods.size(); ++method) {
    metrics_out << (method == 0 ? "" : ",") << "{\"name\":\""
                << json_escape(methods[method]) << "\",\"replications\":[";
    for (std::size_t rep = 0; rep < per_method[method].size(); ++rep) {
      metrics_out << (rep == 0 ? "" : ",");
      write_kernel_metric(metrics_out, per_method[method][rep]);
    }
    metrics_out << "]}";
  }
  metrics_out << "]}\n";
  if (!run_out || !metrics_out) {
    fmt::print(stderr, "error: failed writing mixed-model results in '{}'\n",
               options.results_dir);
    return 1;
  }
  fmt::print("results written to '{}' (run.json, metrics.json)\n",
             options.results_dir);
  return 0;
}

}  // namespace

int run_command(std::span<const std::string> args) {
  RunOptions options;
  bool explicit_model_file = false;
  bool explicit_project = false;
  bool explicit_seed = false;
  bool explicit_reps = false;

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
      options.model_file = value;
      explicit_model_file = true;
    } else if (arg == "--experiment") {
      if (!need_value() || value.empty()) {
        fmt::print(stderr, "error: --experiment needs a value\n");
        return 2;
      }
      options.experiment = value;
#ifdef LOGICPILOT_HAS_DSL
    } else if (arg == "--project") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.project = value;
      explicit_project = true;
    } else if (arg == "--results-dir") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.results_dir = value;
    } else if (arg == "--output-ir") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.output_ir = value;
#else
    } else if (arg == "--project" || arg == "--results-dir" ||
               arg == "--output-ir") {
      fmt::print(stderr, "error: {} requires a DSL-enabled build\n", arg);
      return 2;
#endif
    } else if (arg == "--seed") {
      if (!need_value() || !parse_u64(value, options.seed)) {
        fmt::print(stderr, "error: invalid --seed\n");
        return 2;
      }
      explicit_seed = true;
    } else if (arg == "--random-seed") {
      options.random_seed = true;
    } else if (arg == "--reps") {
      if (!need_value() || !parse_u64(value, options.reps) ||
          options.reps == 0) {
        fmt::print(stderr, "error: invalid --reps\n");
        return 2;
      }
      explicit_reps = true;
    } else if (arg == "--precision-reps") {
      options.precision_reps = true;
    } else if (arg == "--min-reps") {
      if (!need_value() || !parse_u64(value, options.min_reps) ||
          options.min_reps < 2) {
        fmt::print(stderr, "error: invalid --min-reps (must be >= 2)\n");
        return 2;
      }
    } else if (arg == "--max-reps") {
      if (!need_value() || !parse_u64(value, options.max_reps) ||
          options.max_reps < 2) {
        fmt::print(stderr, "error: invalid --max-reps (must be >= 2)\n");
        return 2;
      }
    } else if (arg == "--error-percent") {
      if (!need_value() || !parse_double(value, options.error_percent) ||
          options.error_percent <= 0.0) {
        fmt::print(stderr, "error: invalid --error-percent\n");
        return 2;
      }
    } else if (arg == "--precision-metric") {
      if (!need_value() || value.empty()) {
        fmt::print(stderr, "error: --precision-metric needs a value\n");
        return 2;
      }
      options.precision_metric = value;
    } else if (arg == "--threads") {
      if (!need_value()) {
        return 2;
      }
      options.threads = static_cast<std::size_t>(std::stoull(value));
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
    } else if (arg == "--logical-trace") {
      if (!need_value()) {
        fmt::print(stderr, "error: {} needs a value\n", arg);
        return 2;
      }
      options.logical_trace = value;
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
  if (explicit_seed && options.random_seed) {
    fmt::print(stderr, "error: --seed and --random-seed are mutually exclusive\n");
    return 2;
  }
  ReplicationMetric precision_metric{};
  if (!parse_replication_metric(options.precision_metric, precision_metric)) {
    fmt::print(stderr, "error: invalid --precision-metric '{}'\n",
               options.precision_metric);
    return 2;
  }
  if (options.precision_reps && options.max_reps < options.min_reps) {
    fmt::print(stderr, "error: --max-reps must be >= --min-reps\n");
    return 2;
  }
  if (explicit_project && explicit_model_file) {
    fmt::print(stderr, "error: --project and --model-file are mutually "
                       "exclusive\n");
    return 2;
  }

  // Resolve the executable model.
  std::unique_ptr<ReplicationModel> model;
  std::function<std::unique_ptr<ReplicationModel>()> build_model;
  std::string model_label;
  if (explicit_project) {
#ifdef LOGICPILOT_HAS_DSL
    ProjectBundleInfo bundle;
    std::string bundle_error;
    const bool ok =
        std::filesystem::is_directory(options.project)
            ? read_project_dir(options.project, bundle, bundle_error)
            : [&]() {
                std::ifstream in(options.project, std::ios::binary);
                if (!in) {
                  bundle_error = "cannot read project file";
                  return false;
                }
                const std::string text((std::istreambuf_iterator<char>(in)),
                                       std::istreambuf_iterator<char>());
                return read_project_bundle(text, bundle, bundle_error);
              }();
    if (!ok) {
      fmt::print(stderr, "error: cannot read project '{}': {}\n",
                 options.project, bundle_error);
      return 1;
    }
    const dsl::CompileResult compiled =
        dsl::compile_source(bundle.model_source, bundle.model_path);
    if (!compiled.ok) {
      for (const dsl::Diagnostic& diagnostic : compiled.diagnostics) {
        fmt::print(stderr, "{}\n",
                   dsl::format_diagnostic(bundle.model_path, diagnostic));
      }
      fmt::print(stderr, "compile failed: {} error(s)\n",
                 compiled.diagnostics.size());
      return 1;
    }
    if (!options.output_ir.empty()) {
      std::ofstream out(options.output_ir, std::ios::binary | std::ios::trunc);
      if (!out) {
        fmt::print(stderr, "error: cannot write '{}'\n", options.output_ir);
        return 1;
      }
      out.write(reinterpret_cast<const char*>(compiled.v2_bytes.data()),
                static_cast<std::streamsize>(compiled.v2_bytes.size()));
      out.close();
      if (!out) {
        fmt::print(stderr, "error: failed writing '{}'\n", options.output_ir);
        return 1;
      }
    }
    IrLoadResult loaded = load_model_buffer(compiled.v2_bytes.data(),
                                            compiled.v2_bytes.size());
    if (!loaded.ok()) {
      fmt::print(stderr, "error: failed to load compiled IR: {} ({})\n",
                 loaded.message, to_string(loaded.status));
      return 1;
    }
    std::string experiment_error;
    if (!apply_declared_experiment(loaded.file, options,
                                   explicit_seed || options.random_seed,
                                   explicit_reps, experiment_error)) {
      fmt::print(stderr, "error: {}\n", experiment_error);
      return 2;
    }
    const std::vector<std::uint8_t> model_bytes = loaded.file.v2_bytes;
    build_model = [model_bytes]() -> std::unique_ptr<ReplicationModel> {
      const IrLoadResult re = load_model_buffer(model_bytes.data(),
                                                model_bytes.size());
      std::string error;
      return build_replication_model(re.file, &error);
    };
    model = build_model();
    if (!model) {
      fmt::print(stderr, "error: failed to build the executable model\n");
      return 1;
    }
    model_label = fmt::format("project:{} ({})", options.project,
                              inspect_model(loaded.file));
    if (options.results_dir.empty()) {
      options.results_dir =
          std::filesystem::path(options.project)
              .replace_extension(".results")
              .string();
    }
    if (resolve_method_names(loaded.file).size() > 1) {
      return run_kernel_model(loaded.file, options,
                              fmt::format("project:{}", options.project));
    }
#else
    fmt::print(stderr, "error: --project requires a DSL-enabled build\n");
    return 2;
#endif
  } else if (explicit_model_file) {
    IrLoadResult loaded = load_model_file(options.model_file);
    if (!loaded.ok()) {
      fmt::print(stderr, "error: failed to load IR '{}': {} ({})\n",
                 options.model_file, loaded.message, to_string(loaded.status));
      return 1;
    }
    std::string experiment_error;
    if (!apply_declared_experiment(loaded.file, options,
                                   explicit_seed || options.random_seed,
                                   explicit_reps, experiment_error)) {
      fmt::print(stderr, "error: {}\n", experiment_error);
      return 2;
    }
    if (resolve_method_names(loaded.file).size() > 1) {
      return run_kernel_model(loaded.file, options,
                              fmt::format("file:{}", options.model_file));
    }
    const std::vector<std::uint8_t> model_bytes = loaded.file.v2_bytes;
    build_model = [model_bytes]() -> std::unique_ptr<ReplicationModel> {
      const IrLoadResult re = load_model_buffer(model_bytes.data(),
                                                model_bytes.size());
      std::string error;
      return build_replication_model(re.file, &error);
    };
    model = build_model();
    if (!model) {
      fmt::print(stderr, "error: failed to build the executable model\n");
      return 1;
    }
    model_label = fmt::format("file:{} ({})", options.model_file,
                              inspect_model(loaded.file));
  } else {
    fmt::print(stderr,
               "error: nothing to run - pass --model-file <path.lpir>"
               " (or --project <path.lpproj> in DSL-enabled builds)\n");
    return 2;
  }

  if (!parse_replication_metric(options.precision_metric, precision_metric)) {
    fmt::print(stderr, "error: invalid precision metric '{}'\n",
               options.precision_metric);
    return 2;
  }
  if (options.precision_reps && options.max_reps < options.min_reps) {
    fmt::print(stderr, "error: max replications must be >= min replications\n");
    return 2;
  }
  if (options.random_seed) {
    options.seed = random_run_seed();
  }
  if (dynamic_cast<const ContinuousReplicationModel*>(model.get()) != nullptr &&
      options.threads > 1) {
    fmt::print(stderr,
               "error: continuous models require --threads 1 so numerical "
               "failures can be reported with their equation context\n");
    return 2;
  }

  fmt::print(
      "lpcli run: model={} seed={} seed_mode={} reps={} replication_mode={} arrivals={} warmup={} "
      "confidence={:.2f}\n",
      model_label, options.seed, options.random_seed ? "random" : "fixed",
      options.precision_reps ? options.max_reps : options.reps,
      options.precision_reps ? "precision" : "fixed", options.arrivals,
      options.warmup, options.confidence);

  if (explicit_project) {
    fmt::print("results dir: {}\n", options.results_dir);
  }

  // Run replications (per-replication deterministic stream seeds). Parallel
  // workers each own an isolated model instance (ADR-0009 Phase A); results
  // are bit-identical to a sequential run.
  fmt::print(
      "{:>4}  {:>20}  {:>10}  {:>10}  {:>8}  {:>8}  {:>8}  {:>8}\n", "rep",
      "seed", "departures", "throughput", "L", "Lq", "W", "Wq");
  std::vector<ReplicationMetrics> results;
  const std::uint64_t run_limit =
      options.precision_reps ? options.max_reps : options.reps;
  if (!options.logical_trace.empty() && run_limit != 1) {
    fmt::print(stderr,
               "error: --logical-trace requires exactly one replication\n");
    return 2;
  }
  results.reserve(run_limit);
  TraceRecorder logical_trace;
  TraceRecorder* logical_trace_ptr = nullptr;
  if (!options.logical_trace.empty()) {
    logical_trace.enable_logical_step_records(LogicalTraceCodec::kMaxRecords);
    logical_trace_ptr = &logical_trace;
  }
  const bool sequential =
      options.threads <= 1 || !options.trajectory.empty() ||
      !options.logical_trace.empty() || options.precision_reps;
  if (sequential) {
    // Sequential path reuses the primary `model` so per-run state (e.g. the
    // continuous-model trajectory) stays visible after the loop.
    for (std::uint64_t rep = 0; rep < run_limit; ++rep) {
      ReplicationConfig config;
      config.seed = replication_seed(options.seed, rep);
      config.arrivals = options.arrivals;
      config.warmup_arrivals = options.warmup;
      ReplicationMetrics metrics = model->run(config, logical_trace_ptr);
      if (const auto* continuous =
              dynamic_cast<const ContinuousReplicationModel*>(model.get());
          continuous != nullptr && continuous->failed()) {
        fmt::print(stderr, "error: continuous integration failed: {}\n",
                   continuous->last_error());
        return 1;
      }
      fmt::print(
          "{:>4}  {:>20}  {:>10}  {:>10.4f}  {:>8.4f}  {:>8.4f}  {:>8.4f}  "
          "{:>8.4f}\n",
          rep + 1, config.seed, metrics.departures, metrics.throughput,
          metrics.mean_in_system, metrics.mean_in_queue, metrics.mean_sojourn,
          metrics.mean_wait);
      results.push_back(metrics);
      if (options.precision_reps &&
          replication_precision_reached(
              summarize_replications(results, options.confidence),
              precision_metric, static_cast<std::size_t>(options.min_reps),
              options.error_percent)) {
        break;
      }
    }
  } else {
    // Parallel workers each own an isolated model instance (ADR-0009
    // Phase A); results are bit-identical to a sequential run.
    ReplicationConfig base_config;
    base_config.seed = options.seed;
    base_config.arrivals = options.arrivals;
    base_config.warmup_arrivals = options.warmup;
    results = run_replications_parallel(build_model, base_config,
                                        run_limit, options.threads);
    for (std::uint64_t rep = 0; rep < run_limit; ++rep) {
      const ReplicationMetrics& metrics = results[rep];
      fmt::print(
          "{:>4}  {:>20}  {:>10}  {:>10.4f}  {:>8.4f}  {:>8.4f}  {:>8.4f}  "
          "{:>8.4f}\n",
          rep + 1, replication_seed(options.seed, rep), metrics.departures,
          metrics.throughput, metrics.mean_in_system, metrics.mean_in_queue,
          metrics.mean_sojourn, metrics.mean_wait);
    }
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
  if (options.precision_reps) {
    const double achieved = relative_ci_error_percent(
        replication_metric_summary(summary, precision_metric));
    fmt::print("precision: metric={} error={:.4f}% target={:.4f}% stop={}\n",
               options.precision_metric, achieved, options.error_percent,
               achieved <= options.error_percent ? "target-reached" : "max-reps");
  }
  print_row("throughput", summary.throughput, 0.0, false);
  print_row("L", summary.mean_in_system, 0.0, false);
  print_row("Lq", summary.mean_in_queue, 0.0, false);
  print_row("W", summary.mean_sojourn, 0.0, false);
  print_row("Wq", summary.mean_wait, 0.0, false);
  if (std::any_of(results.begin(), results.end(), [](const ReplicationMetrics& m) {
        return m.measure_count > 0;
      })) {
    print_row("measure", summary.mean_measure, 0.0, false);
  }
  print_row("utilization", summary.utilization, 0.0, false);
  print_row("availability", summary.availability, 0.0, false);
  print_row("final_value", summary.final_value, 0.0, false);

  if (!options.logical_trace.empty()) {
    FileLogicalTraceArchiveStore store{options.logical_trace};
    std::string trace_error;
    if (!store.save(logical_trace, &trace_error)) {
      fmt::print(stderr, "error: cannot write logical trace '{}': {}\n",
                 options.logical_trace, trace_error);
      return 1;
    }
    fmt::print("logical trace written to '{}' ({} steps)\n",
               options.logical_trace, logical_trace.logical_step_count());
  }

  if (!options.results_dir.empty()) {
    const int status =
        write_results(options.results_dir, options, model_label, summary,
                      results);
    if (status != 0) {
      return status;
    }
  }

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
         out << (i > 0 ? "," : "") << "{\"t\":" << json_double(point.t)
             << ",\"values\":[";
         for (std::size_t j = 0; j < point.values.size(); ++j) {
           out << (j > 0 ? "," : "") << json_double(point.values[j]);
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

  return 0;
}

}  // namespace logicpilot::cli
