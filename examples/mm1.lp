// M/M/1 queue - LogicPilot DSL v2 example (docs/specs/dsl-v2.md).
//
// Semantics: Poisson arrivals at rate lambda = 0.8 (exponential
// inter-arrival times), one server with exponential service rate
// mu = 1.0, unbounded FIFO queue. Steady state: rho = 0.8,
// Wq = rho / (mu - lambda) = 4.0. Acceptance constants live in
// examples/mm1.expect.json.
//
// Agent-centric structure: process-library blocks are direct members of the
// model root (no `process` container), connected by model-level `couple`
// lines.
model MM1 {
  use process
  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  resource Server {
    capacity = 1
  }

  source Arrivals {
    arrival = rate(arrival_rate)
  }
  queue WaitLine {
    capacity = 1000000
  }
  service Handle {
    resource = Server
    time = exponential(service_rate)
  }
  sink Done { }

  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
