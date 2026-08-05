// CallCenter - agent-centric example project.
//
// The model root keeps every member: params, the resource pool, the process
// flow blocks and their model-level `couple` lines (no `process` container,
// no scene file for the flow). Nested agents would each live in
// model/scenes/<Agent>.lp, referenced by an `instance` member.
model CallCenter {
  use process

  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  resource Agent {
    capacity = 2
    failure_rate = 0.02
  }

  source Incoming {
    arrival = rate(arrival_rate)
  }
  queue Wait {
    capacity = 100
  }
  service Handle {
    resource = Agent
    time = exponential(service_rate)
  }
  sink Done { }

  couple Incoming.out -> Wait.in
  couple Wait.out -> Handle.in
  couple Handle.out -> Done.in
}
