// M/M/1 queue - LogicPilot DSL v0 example (docs/specs/dsl-spec.md).
//
// Semantics: Poisson arrivals at rate lambda = 0.8 (exponential
// inter-arrival times), one server with exponential service rate
// mu = 1.0, unbounded FIFO queue. Steady state: rho = 0.8,
// Wq = rho / (mu - lambda) = 4.0. Acceptance constants live in
// examples/mm1.expect.json.
model MM1 {
  resource Server {
    capacity = 1
  }

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)
    }
    queue WaitLine {
      capacity = 1000000
    }
    service Server {
      time = exponential(1.0)
    }
  }
}
