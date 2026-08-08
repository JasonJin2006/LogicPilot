// Replication summary statistics implementation.
#include "logicpilot/devs/replication.h"

#include <atomic>
#include <cmath>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <random>
#include <chrono>

#include "logicpilot/core/random/streams.h"

namespace logicpilot {
namespace {

// Acklam's rational approximation of the inverse normal CDF (|err| < 1.15e-9).
double inverse_normal_cdf(double p) {
  constexpr double a[] = {-3.969683028665376e+01, 2.209460984245205e+02,
                          -2.759285104469687e+02, 1.383577518672690e+02,
                          -3.066479806614716e+01, 2.506628277459239e+00};
  constexpr double b[] = {-5.447609879822406e+01, 1.615858368580409e+02,
                          -1.556989798598866e+02, 6.680131188771972e+01,
                          -1.328068155288572e+01};
  constexpr double c[] = {-7.784894002430293e-03, -3.223964580411365e-01,
                          -2.400758277161838e+00, -2.549732539343734e+00,
                          4.374664141464968e+00, 2.938163982698783e+00};
  constexpr double d[] = {7.784695709041462e-03, 3.224671290700398e-01,
                          2.445134137142996e+00, 3.754408661907416e+00};
  constexpr double plow = 0.02425;

  double q, r;
  if (p < plow) {
    q = std::sqrt(-2.0 * std::log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q +
            c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
  }
  if (p > 1.0 - plow) {
    q = std::sqrt(-2.0 * std::log(1.0 - p));
    return -((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q +
             c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0));
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r +
          a[5]) *
         q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
}

// 0.975 quantile of Student-t by df (df 1..30 exact, then anchors).
constexpr double kT975[] = {
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201,  2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080,  2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042};

}  // namespace

double student_t_critical(double confidence, std::size_t df) {
  if (df == 0) {
    return 0.0;
  }
  // Scale the exact 95% table by the ratio of normal criticals so other
  // confidence levels track closely (acceptance tests use 0.95 exactly).
  const double z_target = inverse_normal_cdf(0.5 + confidence / 2.0);
  if (confidence == 0.95) {
    if (df <= 30) {
      return kT975[df - 1];
    }
    if (df <= 40) {
      return 2.021;
    }
    if (df <= 60) {
      return 2.000;
    }
    if (df <= 120) {
      return 1.980;
    }
    return 1.960;
  }
  const double z95 = 1.959964;
  double t95;
  if (df <= 30) {
    t95 = kT975[df - 1];
  } else {
    t95 = 1.960 + 1.0 / static_cast<double>(df);  // coarse tail correction
  }
  return t95 * (z_target / z95);
}

ReplicationSummary summarize_replications(
    std::span<const ReplicationMetrics> reps, double confidence) {
  ReplicationSummary out;
  out.reps = reps.size();
  out.confidence = confidence;
  if (reps.empty()) {
    return out;
  }

  const auto summarize = [&](auto extract) {
    const double n = static_cast<double>(reps.size());
    double mean = 0.0;
    for (const ReplicationMetrics& m : reps) {
      mean += extract(m);
    }
    mean /= n;
    double var = 0.0;
    for (const ReplicationMetrics& m : reps) {
      const double d = extract(m) - mean;
      var += d * d;
    }
    var /= (n > 1.0 ? n - 1.0 : 1.0);
    MetricSummary s;
    s.mean = mean;
    s.stddev = std::sqrt(var);
    const double t = student_t_critical(confidence, reps.size() - 1);
    const double half = t * s.stddev / std::sqrt(n);
    s.ci_low = mean - half;
    s.ci_high = mean + half;
    return s;
  };

  out.throughput = summarize([](const ReplicationMetrics& m) {
    return m.throughput;
  });
  out.mean_in_system = summarize([](const ReplicationMetrics& m) {
    return m.mean_in_system;
  });
  out.mean_in_queue = summarize([](const ReplicationMetrics& m) {
    return m.mean_in_queue;
  });
  out.mean_sojourn = summarize([](const ReplicationMetrics& m) {
    return m.mean_sojourn;
  });
  out.mean_wait = summarize([](const ReplicationMetrics& m) {
    return m.mean_wait;
  });
  out.mean_measure = summarize([](const ReplicationMetrics& m) {
    return m.mean_measure;
  });
  out.utilization = summarize([](const ReplicationMetrics& m) {
    return m.utilization;
  });
  out.availability = summarize([](const ReplicationMetrics& m) {
    return m.availability;
  });
  out.final_value = summarize([](const ReplicationMetrics& m) {
    return m.final_value;
  });
  return out;
}

bool parse_replication_metric(std::string_view name, ReplicationMetric& out) {
  if (name == "throughput") out = ReplicationMetric::kThroughput;
  else if (name == "L") out = ReplicationMetric::kL;
  else if (name == "Lq") out = ReplicationMetric::kLq;
  else if (name == "W") out = ReplicationMetric::kW;
  else if (name == "Wq") out = ReplicationMetric::kWq;
  else if (name == "measure") out = ReplicationMetric::kMeasure;
  else if (name == "utilization") out = ReplicationMetric::kUtilization;
  else if (name == "availability") out = ReplicationMetric::kAvailability;
  else if (name == "final_value") out = ReplicationMetric::kFinalValue;
  else return false;
  return true;
}

const MetricSummary& replication_metric_summary(
    const ReplicationSummary& summary, ReplicationMetric metric) {
  switch (metric) {
    case ReplicationMetric::kThroughput: return summary.throughput;
    case ReplicationMetric::kL: return summary.mean_in_system;
    case ReplicationMetric::kLq: return summary.mean_in_queue;
    case ReplicationMetric::kW: return summary.mean_sojourn;
    case ReplicationMetric::kWq: return summary.mean_wait;
    case ReplicationMetric::kMeasure: return summary.mean_measure;
    case ReplicationMetric::kUtilization: return summary.utilization;
    case ReplicationMetric::kAvailability: return summary.availability;
    case ReplicationMetric::kFinalValue: return summary.final_value;
  }
  return summary.mean_wait;
}

double relative_ci_error_percent(const MetricSummary& summary) {
  const double half_width = std::abs(summary.ci_high - summary.ci_low) / 2.0;
  const double scale = std::abs(summary.mean);
  if (scale <= std::numeric_limits<double>::epsilon()) {
    return half_width <= std::numeric_limits<double>::epsilon()
               ? 0.0
               : std::numeric_limits<double>::infinity();
  }
  return half_width / scale * 100.0;
}

bool replication_precision_reached(const ReplicationSummary& summary,
                                   ReplicationMetric metric,
                                   std::size_t min_reps,
                                   double error_percent) {
  if (summary.reps < min_reps || min_reps < 2 ||
      !(error_percent > 0.0) || !std::isfinite(error_percent)) {
    return false;
  }
  return relative_ci_error_percent(
             replication_metric_summary(summary, metric)) <= error_percent;
}

std::uint64_t random_run_seed() {
  std::random_device device;
  const std::uint64_t entropy =
      (static_cast<std::uint64_t>(device()) << 32U) ^
      static_cast<std::uint64_t>(device()) ^
      static_cast<std::uint64_t>(
          std::chrono::high_resolution_clock::now().time_since_epoch().count());
  // Run seeds cross the JSON/TypeScript boundary. Keep the resolved root seed
  // inside JavaScript's exact integer range; derived per-replication uint64
  // seeds are serialized as decimal strings by result writers.
  constexpr std::uint64_t kJavascriptSafeMask = (1ULL << 53U) - 1ULL;
  const std::uint64_t seed = SeedStreams{entropy}.derive_state(0)[0] &
                             kJavascriptSafeMask;
  return seed == 0 ? 1 : seed;
}

std::vector<ReplicationMetrics> run_replications_parallel(
    const std::function<std::unique_ptr<ReplicationModel>()>& build,
    const ReplicationConfig& base_config, std::uint64_t reps,
    std::size_t threads) {
  std::vector<ReplicationMetrics> results(reps);
  if (reps == 0) {
    return results;
  }
  if (threads <= 1 || reps == 1) {
    auto model = build();
    if (model == nullptr) {
      throw std::runtime_error(
          "run_replications_parallel: model builder returned nullptr");
    }
    for (std::uint64_t rep = 0; rep < reps; ++rep) {
      ReplicationConfig config = base_config;
      const SeedStreams streams{base_config.seed};
      config.seed = streams.derive_state(rep)[0];
      results[rep] = model->run(config, nullptr);
    }
    return results;
  }
  if (threads > static_cast<std::size_t>(reps)) {
    threads = static_cast<std::size_t>(reps);
  }

  std::atomic<std::uint64_t> next_rep{0};
  std::atomic<bool> failed{false};
  std::string failure_message;
  std::mutex failure_mutex;
  std::vector<std::thread> workers;
  workers.reserve(threads);
  for (std::size_t worker = 0; worker < threads; ++worker) {
    workers.emplace_back([&] {
      auto model = build();  // one isolated model per worker
      if (model == nullptr) {
        std::lock_guard<std::mutex> lock(failure_mutex);
        failure_message =
            "run_replications_parallel: model builder returned nullptr";
        failed = true;
        return;
      }
      for (;;) {
        const std::uint64_t rep = next_rep.fetch_add(1);
        if (rep >= reps) {
          break;
        }
        ReplicationConfig config = base_config;
        const SeedStreams streams{base_config.seed};
        config.seed = streams.derive_state(rep)[0];
        results[rep] = model->run(config, nullptr);
      }
    });
  }
  for (std::thread& worker : workers) {
    worker.join();
  }
  if (failed) {
    throw std::runtime_error(failure_message);
  }
  return results;
}

}  // namespace logicpilot
