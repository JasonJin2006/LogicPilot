// M/M/1 with server breakdowns - LogicPilot DSL example (milestone 1).
//
// Semantics: Poisson arrivals at rate lambda = 0.8, one server with
// exponential service rate mu = 1.0, unbounded FIFO queue. The server fails
// while busy at exponential rate f = 0.1 (failures per busy time unit) and
// repairs at exponential rate r = 1.0 (repair_rate defaults to 1.0 when the
// field is omitted). Availability a = r / (f + r) = 0.9091, effective
// service rate mu_eff = a * mu = 0.9091 (preemptive-repeat-different, exact
// for exponential failure/repair); steady state:
//   rho_eff = lambda / mu_eff = 0.88
//   Wq = lambda * E[S_eff^2] / (2 * (1 - rho_eff)) = 8.73   (M/G/1, second
//   moment; the effective service law is no longer exponential, so the
//   plain M/M/1 formula understates the wait)
// Acceptance constants live in examples/mm1_failure.expect.json.
model MM1Failure {
  resource Server {
    capacity = 1
    failure_rate = 0.1
  }

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)
    }
    queue WaitLine {
      capacity = 1000000
    }
    service Handle {
      resource = Server
      time = exponential(1.0)
    }
  }
}
