// SelectOutputIn + SelectOutputOut (AnyLogic): a "quasi" SelectOutput with
// any number of exits. The In block routes each agent to one of the
// associated Out blocks - here by the probabilities declared on the Out
// blocks (Fast 0.7 / Slow 0.3) - and the Out blocks forward the agent to
// their downstream. Out blocks are never connected to the In block
// graphically; the association is by name (selectOutputIn = Route).
model QuasiSelect {
  source Jobs {
    arrival = rate(2.0)
  }
  selectOutputIn Route {
  }
  selectOutputOut Fast {
    selectOutputIn = Route
    probability = 0.7
  }
  selectOutputOut Slow {
    selectOutputIn = Route
    probability = 0.3
  }
  sink A { }
  sink B { }
  couple Jobs.out -> Route.in
  couple Fast.out -> A.in
  couple Slow.out -> B.in
}
