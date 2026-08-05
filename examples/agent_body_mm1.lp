// Agent-centric M/M/1 with the flow inside an agent body: the process flow
// lives as members of the root-level `agent Worker` (no `process` wrapper),
// connected by the agent's own `couple` lines. The kernel lowers the agent
// body as a flow scope and runs it identically to examples/flat_mm1.lp
// (bit-exact for the same seed and run parameters).
model AgentBodyMM1 {
  use process

  agent Worker {
    count = 1

    resource Server {
      capacity = 1
    }

    source Arrivals {
      arrival = rate(0.8)
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
}
