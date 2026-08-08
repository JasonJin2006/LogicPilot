// SelectOutput5 (AnyLogic): one input, five outputs. In conditions mode the
// conditions are evaluated in order and the agent takes the first true
// exit; when all conditions are false it takes the last (default) exit
// out5. Here every agent has size = 10, so condition1 (size > 5) is true
// and all agents go to out1 -> Big; change the source state to 3 and they
// take out5 -> Small instead.
model SelectOutput5 {
  source Jobs {
    arrival = rate(2.0)
    state size: int = 10
  }
  selectOutput5 Route {
    type = conditions
    condition1 = size > 5
  }
  sink Big { }
  sink Small { }
  couple Jobs.out -> Route.in
  couple Route.out1 -> Big.in
  couple Route.out5 -> Small.in
}
