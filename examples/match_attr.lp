// Match pairing on an entity attribute (AnyLogic matchCondition): the
// field names the attribute, and agents pair when their values are equal.
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
    matchCondition = kind
  }
  sink K1 { }
  sink K2 { }
  couple A.out -> Sync.in1
  couple B.out -> Sync.in2
  couple Sync.out1 -> K1.in
  couple Sync.out2 -> K2.in
}
