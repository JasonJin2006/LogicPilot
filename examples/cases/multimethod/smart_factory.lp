// Complex integration case: all five executable paradigms share one model
// root and one SimulationKernel clock/queue. The methods remain independent
// semantically in v0.1; this case verifies composition and scheduling, not a
// yet-unsupported cross-formalism value coupling.
model SmartFactory {
  use process

  resource Machine {
    capacity = 2
  }
  source Jobs {
    arrival = rate(0.6)
  }
  queue Buffer {
    capacity = 1000
  }
  service Work {
    resource = Machine
    time = exponential(1.0)
  }
  sink Finished { }

  couple Jobs.out -> Buffer.in
  couple Buffer.out -> Work.in
  couple Work.out -> Finished.in

  agent Inspectors {
    count = 256
    state active = true
    on_tick { flip active; bounce }
  }

  statechart Controller {
    initial = Running
    state Running { }
    state Maintenance { }
    transition stop {
      from = Running; to = Maintenance
      triggeredBy = timeout; timeout = 5.0
    }
    transition restart {
      from = Maintenance; to = Running
      triggeredBy = timeout; timeout = 2.0
    }
  }

  continuous Temperature {
    state temperature = 80.0
    param ambient = 20.0
    param cooling = 0.05
    d temperature/dt = -cooling*(temperature-ambient)
  }

  atomic Heartbeat {
    time_advance = constant(1.0)
    on_timeout { emit pulse }
  }
}
