// Match pairing via the canonical AnyLogic matchCondition form
// `agent1.kind == agent2.kind`: agents pair when the attribute matches.
model MatchAttr {
  source A {
    arrival = rate(1.0)
    state kind: int = 1
  }
  source B {
    arrival = rate(1.0)
    state kind: int = 1
  }
  match Sync {
    matchCondition = agent1.kind == agent2.kind
  }
  sink K1 { }
  sink K2 { }
  couple A.out -> Sync.in1
  couple B.out -> Sync.in2
  couple Sync.out1 -> K1.in
  couple Sync.out2 -> K2.in
}
