// M/M/2 queue - multi-server visualization example.
//
// Two parallel servers (resource capacity = 2), Poisson arrivals at rate
// lambda = 1.6 and exponential service rate mu = 1.0 per server, so the
// offered load a = lambda / mu = 1.6 < c = 2 (stable). The web QueueView
// renders one service cell per server; in-service customers sit on their
// server cell.
//
// Agent-centric structure: process-library blocks are direct members of the
// model root (no `process` container), connected by model-level `couple`
// lines.
model TwoServers {
  resource Server {
    capacity = 2
  }

  source Arrivals {
    arrival = poisson(1.6)
  }
  queue WaitLine {
    capacity = 1000000
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  sink Done { }

  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
