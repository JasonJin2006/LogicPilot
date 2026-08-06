// Entity attributes: the source declares `state size = 10` on every emitted
// agent; selectOutput routes on the attribute at runtime.
model AttributeRouting {
  source Jobs {
    arrival = rate(2.0)
    state size: int = 10
  }
  selectOutput Route {
    condition = size > 5
  }
  sink Big { }
  sink Small { }
  couple Jobs.out -> Route.in
  couple Route.outT -> Big.in
  couple Route.outF -> Small.in
}
