// Agent-centric M/M/1: process-library blocks live directly under the
// model root (no `process` wrapper), connected by root-level `couple`
// lines. Semantics identical to examples/mm1.lp.
model FlatMM1 {
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
