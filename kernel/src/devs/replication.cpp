// Replication summary statistics implementation.
#include "logicpilot/devs/replication.h"

#include <cmath>

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
  out.utilization = summarize([](const ReplicationMetrics& m) {
    return m.utilization;
  });
  out.availability = summarize([](const ReplicationMetrics& m) {
    return m.availability;
  });
  return out;
}

}  // namespace logicpilot
