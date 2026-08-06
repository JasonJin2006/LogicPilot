// Comparison-based queuing (AnyLogic): agents are placed by the expression
// `agent1IsPreferredToAgent2` — here larger entities jump ahead.
model ComparisonQueue {
  resource Server {
    capacity = 1
  }
  source Small {
    arrival = rate(1.0)
    state size: int = 1
  }
  source Large {
    arrival = rate(1.0)
    state size: int = 5
  }
  queue Buffer {
    capacity = 100
    queuing = queuing_comparison
    agent1IsPreferredToAgent2 = agent1.size > agent2.size
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  sink Done {
  }
  couple Small.out -> Buffer.in
  couple Large.out -> Buffer.in
  couple Buffer.out -> Handle.in
  couple Handle.out -> Done.in
}
