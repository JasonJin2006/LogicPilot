// Statechart condition transition: `wait` fires when the condition
// `t >= 2.0` becomes true (conditions are polled continuously like
// AnyLogic). Proves the DSL -> IR -> kernel expression path.
model ConditionLight {
  statechart Light {
    initial = Idle
    state Idle { }
    state Done { }
    transition wait { from = Idle; to = Done; triggeredBy = condition; condition = t >= 2.0 }
  }
}
