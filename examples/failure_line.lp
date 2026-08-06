// Busy-time failures in the generic process engine: the `count` block forces
// the ProcessFlowSim path, where the service now honors the resource pool's
// failure_rate/repair_rate (preemptive-repeat, same semantics as the
// dedicated M/M/1 path).
model FailureLine {
  resource Server {
    capacity = 1
    failure_rate = 0.1
    repair_rate = 1.0
  }
  source Jobs {
    arrival = rate(0.8)
  }
  queue Buffer {
    capacity = 100
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  count Meter {
  }
  sink Done {
  }
  couple Jobs.out -> Buffer.in
  couple Buffer.out -> Handle.in
  couple Handle.out -> Meter.in
  couple Meter.out -> Done.in
}
