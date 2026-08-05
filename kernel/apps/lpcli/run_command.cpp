// lpcli `run` subcommand implementation.
#include "run_command.h"

#include <charconv>
#include <ctime>
#include <filesystem>
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
#ifdef LOGICPILOT_HAS_DSL
      "  --project <path.lpproj>    compile the bundled DSL and run it\n"
      "  --output-ir <path>         write the compiled IR (with --project)\n"
      "  --results-dir <path>       write run.json + metrics.json here\n"
      "                             (default <project stem>.results/)\n"
#endif
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

std::string json_double(double value) {
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
        << "  \"reps\": " << options.reps << ",\n"
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
    write_metric(out, "utilization", summary.utilization, false);
    write_metric(out, "availability", summary.availability, false);
    write_metric(out, "final_value", summary.final_value, false);
    out << "\n  },\n  \"replications\": [";
    for (std::size_t i = 0; i < results.size(); ++i) {
      const ReplicationMetrics& m = results[i];
      out << (i > 0 ? "," : "") << "\n    {\"rep\":" << (i + 1)
          << ",\"seed\":" << replication_seed(options.seed, i)
          << ",\"arrivals\":" << m.arrivals
          << ",\"departures\":" << m.departures
          << ",\"throughput\":" << json_double(m.throughput)
          << ",\"L\":" << json_double(m.mean_in_system)
          << ",\"Lq\":" << json_double(m.mean_in_queue)
          << ",\"W\":" << json_double(m.mean_sojourn)
          << ",\"Wq\":" << json_double(m.mean_wait)
          << ",\"utilization\":" << json_double(m.utilization)
          << ",\"availability\":" << json_double(m.availability)
          << ",\"final_value\":" << json_double(m.final_value) << "}";
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

}  // namespace

int run_command(std::span<const std::string> args) {
  RunOptions options;
  bool explicit_model_file = false;
  bool explicit_project = false;

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
  if (explicit_project && explicit_model_file) {
    fmt::print(stderr, "error: --project and --model-file are mutually "
                       "exclusive\n");
    return 2;
  }

  // Resolve the executable model.
  std::unique_ptr<ReplicationModel> model;
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
    std::string build_error;
    model = build_replication_model(loaded.file, &build_error);
    if (!model) {
      fmt::print(stderr, "error: {}\n", build_error);
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

  if (explicit_project) {
    fmt::print("results dir: {}\n", options.results_dir);
  }

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
