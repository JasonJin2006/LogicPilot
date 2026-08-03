// Continuous-time integration interfaces.
//
// LogicPilot is a discrete-event kernel, but SD (system dynamics) stocks and
// flows require fixed-step continuous integration between events (wired up in
// Phase 5). This header defines the integrator contract plus explicit
// fixed-step Euler and RK4 implementations. Both are fully deterministic:
// identical inputs produce bit-identical outputs.
#pragma once

#include <cstddef>
#include <functional>
#include <span>
#include <vector>

namespace logicpilot {

// Computes dy/dt = f(t, y) into `dy`. Both spans have identical length.
using DerivativeFn =
    std::function<void(double t, std::span<const double> y, std::span<double> dy)>;

class IIntegrator {
 public:
  virtual ~IIntegrator() = default;

  // Advance state `y` from time `t` to `t + dt` with a single fixed step.
  virtual void step(double t, double dt, std::span<double> y,
                    const DerivativeFn& f) = 0;

  // Advance over [t, t + duration] using `n` fixed sub-steps.
  void integrate(double t, double duration, std::size_t n, std::span<double> y,
                 const DerivativeFn& f) {
    const double dt = duration / static_cast<double>(n);
    for (std::size_t i = 0; i < n; ++i) {
      step(t + dt * static_cast<double>(i), dt, y, f);
    }
  }
};

// First-order explicit Euler. Cheap; O(dt) local error.
class EulerIntegrator final : public IIntegrator {
 public:
  void step(double t, double dt, std::span<double> y,
            const DerivativeFn& f) override {
    dy_.resize(y.size());
    f(t, y, std::span<double>{dy_});
    for (std::size_t i = 0; i < y.size(); ++i) {
      y[i] += dt * dy_[i];
    }
  }

 private:
  std::vector<double> dy_;
};

// Classic fourth-order Runge-Kutta. O(dt^4) local error; four derivative
// evaluations per step. Scratch buffers are cached so steady-state stepping
// performs no dynamic allocation.
class RungeKutta4Integrator final : public IIntegrator {
 public:
  void step(double t, double dt, std::span<double> y,
            const DerivativeFn& f) override {
    const std::size_t n = y.size();
    k1_.resize(n);
    k2_.resize(n);
    k3_.resize(n);
    k4_.resize(n);
    tmp_.resize(n);

    f(t, y, std::span<double>{k1_});

    for (std::size_t i = 0; i < n; ++i) tmp_[i] = y[i] + 0.5 * dt * k1_[i];
    f(t + 0.5 * dt, std::span<const double>{tmp_}, std::span<double>{k2_});

    for (std::size_t i = 0; i < n; ++i) tmp_[i] = y[i] + 0.5 * dt * k2_[i];
    f(t + 0.5 * dt, std::span<const double>{tmp_}, std::span<double>{k3_});

    for (std::size_t i = 0; i < n; ++i) tmp_[i] = y[i] + dt * k3_[i];
    f(t + dt, std::span<const double>{tmp_}, std::span<double>{k4_});

    for (std::size_t i = 0; i < n; ++i) {
      y[i] += (dt / 6.0) * (k1_[i] + 2.0 * k2_[i] + 2.0 * k3_[i] + k4_[i]);
    }
  }

 private:
  std::vector<double> k1_, k2_, k3_, k4_, tmp_;
};

}  // namespace logicpilot
