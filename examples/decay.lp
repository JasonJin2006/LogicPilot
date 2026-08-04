// Exponential decay - Phase D2 DSL example.
//
// dy/dt = -k*y with y(0) = 1.0 and k = 0.5. Analytic solution:
// y(t) = e^{-k t}, so y(10) = e^{-5} ~ 0.00674. The ODE engine integrates
// with fixed-step RK4; `lpcli run --arrivals N` = N steps of dt = 0.01.
model Decay {
  continuous Dynamics {
    state y = 1.0
    param k = 0.5
    d y/dt = -k*y
  }
}
